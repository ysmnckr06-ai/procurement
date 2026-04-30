import os
import shutil
import re
import unicodedata

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from app.parsers.excel_parser import parse_excel
from app.parsers.pdf_parser import parse_pdf
from app.parsers.image_parser import parse_image
from app.parsers.request_parser import parse_request_file

from app.services.matcher import match_offers_to_requests
from app.services.analyzer import analyze_groups
from app.services.report_builder import build_excel_report
from app.services.request_report_builder import build_request_report

from app.utils import normalize_text


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMP_DIR = os.path.join(BASE_DIR, "app", "temp")
os.makedirs(TEMP_DIR, exist_ok=True)


def detect_file_type(filename: str) -> str:
    ext = filename.lower().split(".")[-1]
    if ext in ["xlsx", "xls"]:
        return "excel"
    if ext == "pdf":
        return "pdf"
    if ext in ["png", "jpg", "jpeg", "webp"]:
        return "image"
    return "unknown"

def clean_key(value: str) -> str:
    import re

    text = value.lower()

    # Türkçe karakter normalize
    text = (
        text.replace("ı", "i")
            .replace("ğ", "g")
            .replace("ü", "u")
            .replace("ş", "s")
            .replace("ö", "o")
            .replace("ç", "c")
    )

    # Fazla boşluk temizle
    text = re.sub(r"\s+", " ", text)

    # Harf dışı karakterleri temizle
    text = re.sub(r"[^a-z0-9\s]", "", text)

    # Kelime bazlı sadeleştirme (GENEL!)
    words = text.split()

    normalized_words = []
    for w in words:
        # çok küçük farkları normalize et (OCR hataları)
        if len(w) > 4:
            w = w[:5]  # kök mantığı gibi davranır

        normalized_words.append(w)

    return " ".join(normalized_words).strip()

def find_merge_key(merged: dict, kod_key: str, aciklama_key: str, birim_key: str):

    # 1) EN GÜÇLÜ: açıklama + birim
    for key, item in merged.items():
        if (
            item.get("_aciklamaKey") == aciklama_key
            and item.get("_birimKey") == birim_key
        ):
            return key

    # 2) açıklama yoksa fallback: kod + birim
    if kod_key:
        for key, item in merged.items():
            if (
                item.get("_kodKey") == kod_key
                and item.get("_birimKey") == birim_key
            ):
                return key

    return None

@app.get("/")
def root():
    return {"status": "ok", "message": "Procurement backend is running"}


@app.get("/test-upload", response_class=HTMLResponse)
def test_upload_page():
    return """
    <html>
        <head>
            <meta charset="utf-8" />
            <title>Teklif Test Upload</title>
        </head>
        <body style="font-family: Arial; padding: 30px;">
            <h2>Teklif Dosyaları Test</h2>
            <form action="/analyze-offers" enctype="multipart/form-data" method="post">
                <label><b>Dosyalar:</b></label><br><br>
                <input type="file" name="files" multiple><br><br>
                <label><b>Firma adları (virgülle):</b></label><br><br>
                <input
                    type="text"
                    name="firma_adlari_text"
                    style="width: 450px; padding: 8px;"
                    value="A Firması, B Firması, C Firması"
                ><br><br>
                <button type="submit" style="padding: 10px 18px;">Analiz Et</button>
            </form>
        </body>
    </html>
    """


@app.post("/analyze-offers")
async def analyze_offers(
    files: list[UploadFile] = File(...),
    firma_adlari_text: str = Form(...),
    request_report_path: str = Form(""),
    request_file_name: str = Form("")
):
    all_rows = []
    warnings = []
    print("SEÇİLEN TALEP DOSYASI:", request_file_name)
    print("SEÇİLEN TALEP PATH:", request_report_path)

    if len(files) > 15:
        return {
            "success": False,
            "warnings": ["En fazla 15 dosya yükleyebilirsiniz."],
            "rows": [],
            "reportPath": None,
            "totalRows": 0
        }

    firma_adlari = [x.strip() for x in firma_adlari_text.split(",") if x.strip()]

    for i, upload in enumerate(files):
        firma_adi = firma_adlari[i] if i < len(firma_adlari) else f"Firma {i + 1}"
        file_type = detect_file_type(upload.filename)
        save_path = os.path.join(TEMP_DIR, upload.filename)

        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)

        try:
            if file_type == "excel":
                rows = parse_excel(save_path, firma_adi, upload.filename)
            elif file_type == "pdf":
                rows = parse_pdf(save_path, firma_adi, upload.filename)
            elif file_type == "image":
                rows = parse_image(save_path, firma_adi, upload.filename)
            else:
                rows = []
                warnings.append(f"Desteklenmeyen dosya: {upload.filename}")

            if not rows:
                warnings.append(f"Veri okunamadı: {upload.filename}")

            all_rows.extend(rows)

        except Exception as e:
            print("DOSYA HATASI:", upload.filename, str(e))
            warnings.append(f"Hata ({upload.filename}): {str(e)}")

    if not all_rows:
        return {
            "success": False,
            "warnings": warnings,
            "reportPath": None
        }

    filtered = []
    for row in all_rows:
        has_code = bool(row.get("urunKodu"))
        has_desc = bool(row.get("urunAciklamasi"))
        has_price = float(row.get("birimFiyat", 0) or 0) > 0

        if (has_code or has_desc) and has_price:
            filtered.append(row)

    if not filtered:
        return {
            "success": False,
            "warnings": warnings + ["Geçerli ürün/fiyat satırı bulunamadı."],
            "reportPath": None
        }

# --- TALEP listesini oku ---
    request_items = []

    if request_report_path:
        request_file_path = os.path.join(
        TEMP_DIR,
        os.path.basename(request_report_path)
    )

    if os.path.exists(request_file_path):
        request_items = parse_request_file(request_file_path, request_file_name)
    else:
        print("TALEP DOSYASI BULUNAMADI")

    # --- TEKLİFLERİ TALEBE GÖRE EŞLE ---
    groups = match_offers_to_requests(filtered, request_items)





    exchange_rates = {
        "TRY": 1.0,
        "USD": 39.2,
        "EUR": 42.8
    }

    analyzed = analyze_groups(groups, exchange_rates)

    report_name = "mukayese_raporu.xlsx"
    report_path = os.path.join(TEMP_DIR, report_name)
    build_excel_report(analyzed, report_path)

    return {
        "success": True,
        "reportPath": f"/download-report/{report_name}",
        "warnings": warnings,
        "totalRows": len(filtered),
        "totalGroups": len(analyzed)
    }


@app.get("/download-report/{file_name}")
def download_report(file_name: str):
    file_path = os.path.join(TEMP_DIR, file_name)
    if not os.path.exists(file_path):
        return {"success": False, "message": "Dosya bulunamadı."}
    return FileResponse(
        path=file_path,
        filename=file_name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@app.post("/analyze-requests")
async def analyze_requests(
    files: list[UploadFile] = File(...)
):
    all_rows = []
    warnings = []
    print("BACKEND GELEN DOSYALAR:", [upload.filename for upload in files])

    for upload in files:
        save_path = os.path.join(TEMP_DIR, upload.filename)

        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)

        try:
            rows = parse_request_file(save_path, upload.filename)
            print("OKUNAN DOSYA:", upload.filename)
            print("OKUNAN SATIR SAYISI:", len(rows))
            print("OKUNAN SATIRLAR:", rows[:20])

            if not rows:
                warnings.append(f"Veri okunamadı: {upload.filename}")

            all_rows.extend(rows)

        except Exception as e:
            warnings.append(f"Hata ({upload.filename}): {str(e)}")

    if not all_rows:
        return {
            "success": False,
            "warnings": warnings + ["Talep dosyalarından okunabilir ürün bulunamadı."],
            "rows": [],
            "reportPath": None,
            "totalRows": 0
        }

    # --- Merge / birleştirme ---
    merged = {}
    auto_code_counter = 1

    for row in all_rows:
        kod = str(row.get("urunKodu", "") or "").strip()
        aciklama = str(row.get("urunAciklamasi", "") or "").strip()
        birim = str(row.get("birim", "adet") or "adet").strip().lower()
        adet_raw = row.get("talepEdilenAdet", 0)

        try:
            adet = float(str(adet_raw).replace(",", "."))
        except:
            adet = 0

        if normalize_text(kod) in ["nan", "none", "null", "-"]:
            kod = ""

        if normalize_text(aciklama) in ["", "nan", "none", "null", "-"]:
            continue

        if normalize_text(birim) in ["", "nan", "none", "null", "-"]:
            birim = "adet"

        if adet <= 0:
            continue

        kod_key = clean_key(kod)
        aciklama_key = clean_key(aciklama)
        birim_key = clean_key(birim)

        print("MERGE DEBUG:", {
            "kod": kod,
            "kod_key": kod_key,
            "aciklama": aciklama,
            "aciklama_key": aciklama_key,
            "birim": birim,
            "birim_key": birim_key,
            "adet": adet,
                })

        merge_key = find_merge_key(merged, kod_key, aciklama_key, birim_key)

        if merge_key is None:
            if kod_key:
                merge_key = f"KOD_{kod_key}_{birim_key}"
            else:
                merge_key = f"ACIKLAMA_{aciklama_key}_{birim_key}"
            merged[merge_key] = {
                "urunKodu": kod or "",
                "urunAciklamasi": aciklama,
                "talepEdilenAdet": adet,
                "birim": birim,
                "kaynakDosya": row.get("kaynakDosya", ""),
                "kaynakTipi": row.get("kaynakTipi", ""),
                "_kodKey": kod_key,
                "_aciklamaKey": aciklama_key,
                "_birimKey": birim_key,
            }
        else:
            #merged[merge_key]["tumKodlar"].add(kod)
            merged[merge_key]["talepEdilenAdet"] += adet
            if not merged[merge_key]["urunKodu"] and kod:
                merged[merge_key]["urunKodu"] = kod
                merged[merge_key]["_kodKey"] = kod_key

    # --- Sonuç listesi oluştur ---
    result_rows = []
    for item in merged.values():
        if not item["urunKodu"]:
            item["urunKodu"] = f"PRD-{auto_code_counter:04d}"
            auto_code_counter += 1

        item.pop("_kodKey", None)
        item.pop("_aciklamaKey", None)
        item.pop("_birimKey", None)

        result_rows.append(item)

    report_name = "talep_listesi.xlsx"
    report_path = os.path.join(TEMP_DIR, report_name)
    build_request_report(result_rows, report_path)

    return {
        "success": True,
        "warnings": warnings,
        "rows": result_rows,
        "reportPath": f"/download-request-report/{report_name}",
        "totalRows": len(result_rows)
    }


@app.get("/download-request-report/{file_name}")
def download_request_report(file_name: str):
    file_path = os.path.join(TEMP_DIR, file_name)
    if not os.path.exists(file_path):
        return {"success": False, "message": "Dosya bulunamadı."}
    return FileResponse(
        path=file_path,
        filename=file_name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )