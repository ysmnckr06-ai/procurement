import os
import shutil

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, HTMLResponse

from app.parsers.excel_parser import parse_excel
from app.parsers.pdf_parser import parse_pdf
from app.parsers.image_parser import parse_image
from app.services.matcher import group_rows
from app.services.analyzer import analyze_groups
from app.services.report_builder import build_excel_report

app = FastAPI()

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


@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "Procurement backend is running"
    }


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
    firma_adlari_text: str = Form(...)
):
    all_rows = []
    warnings = []

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

    groups = group_rows(filtered)

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