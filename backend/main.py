import os
import shutil
import re
import json
import uuid
import requests

from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path)

from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
)

from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from app.parsers.excel_parser import parse_excel
from app.parsers.pdf_parser import parse_pdf
from app.parsers.image_parser import parse_image
from app.parsers.request_parser import parse_request_file

from app.services.matcher import match_offers_to_requests, group_rows
from app.services.analyzer import analyze_groups
from app.services.report_builder import build_excel_report
from app.services.request_report_builder import build_request_excel_report

from app.utils import normalize_text

def safe_float_form(val):
    try:
        if val is None or val == "":
            return None
        return float(str(val).replace(",", "."))
    except:
        return None

def safe_int_form(val):
    try:
        if val is None or val == "":
            return None
        return int(val)
    except:
        return None
    
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "https://procurement-dun.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def save_report_to_supabase(report_data):

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("SUPABASE ENV eksik")
        return

    url = f"{SUPABASE_URL}/rest/v1/reports"

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }

    response = requests.post(
        url,
        headers=headers,
        json=report_data
    )

    print("SUPABASE REPORT RESPONSE:", response.status_code)
    print(response.text)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMP_DIR = os.path.join(BASE_DIR, "app", "temp")
REPORTS_FILE = os.path.join(TEMP_DIR, "reports.json")
ORDERS_FILE = os.path.join(TEMP_DIR, "orders.json")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

def verify_user_token(authorization: str):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header eksik")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Geçersiz token formatı")

    token = authorization.replace("Bearer ", "").strip()

    if not token:
        raise HTTPException(status_code=401, detail="Token boş")

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase ayarları eksik")

    try:
        response = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
    except requests.RequestException as e:
        print("SUPABASE AUTH CONNECTION ERROR:", str(e))
        raise HTTPException(
            status_code=503,
            detail="Supabase kullanıcı doğrulamasına ulaşılamadı. Lütfen tekrar deneyin.",
        )

    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Token doğrulanamadı")

    user = response.json()

    if not user.get("id"):
        raise HTTPException(status_code=401, detail="Kullanıcı bilgisi alınamadı")

    return user

def load_json(path):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def clean_supplier_name(name):
    name = str(name or "").strip()
    name = name.replace("_", " ").replace("-", " ")
    name = re.sub(r"\bteklif\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+", " ", name).strip()

    return name.title() if name else "-"

def find_best_supplier(analyzed):
    counts = {}

    for group in analyzed:
        best = (
            group.get("best")
            or group.get("bestOffer")
            or group.get("onerilenTeklif")
            or {}
        )

        firma = best.get("firmaAdi") or best.get("firma")

        if firma:
            counts[firma] = counts.get(firma, 0) + 1

    if not counts:
        return "-"

    return clean_supplier_name(max(counts, key=counts.get))

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
    text = str(value or "").lower()

    text = (
        text.replace("ı", "i")
        .replace("ğ", "g")
        .replace("ü", "u")
        .replace("ş", "s")
        .replace("ö", "o")
        .replace("ç", "c")
    )

    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[^a-z0-9\s]", "", text)

    words = text.split()
    normalized_words = []

    for w in words:
        if len(w) > 4:
            w = w[:5]
        normalized_words.append(w)

    return " ".join(normalized_words).strip()

def find_merge_key(merged: dict, kod_key: str, aciklama_key: str, birim_key: str):
    for key, item in merged.items():
        if (
            item.get("_aciklamaKey") == aciklama_key
            and item.get("_birimKey") == birim_key
        ):
            return key

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

@app.post("/analyze-offers")
async def analyze_offers(
    files: list[UploadFile] = File(...),
    firma_adlari_text: str = Form(""),
    request_id: str = Form(""),
    request_report_path: str = Form(""),
    request_file_name: str = Form(""),

    max_budget: str = Form(""),
    min_vade_days: str = Form(""),
    max_termin_days: str = Form(""),
    allow_missing_qty: str = Form("false"),
    authorization: str = Header(None),
    annual_interest_rate: float = Form(45),

    critical_level: str = Form("medium"),
    delay_impact: str = Form("medium"),
    alternative_stock: str = Form("partial"),

    shipping_included: str = Form("included"),
    shipping_cost: float = Form(0),

    supplier_trust: str = Form("medium"),
    quality_history: str = Form("unknown"),

    currency_risk: str = Form("medium"),

):
    user = verify_user_token(authorization)
    user_id = user["id"]

    if len(files) > 15:
        raise HTTPException(status_code=400, detail="En fazla 15 dosya yükleyebilirsiniz.")

    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

    for file in files:

        allowed_extensions = [".pdf", ".xlsx", ".xls", ".png", ".jpg", ".jpeg"]

        if not any(file.filename.lower().endswith(ext) for ext in allowed_extensions):
            raise HTTPException(
                status_code=400,
                detail=f"{file.filename} desteklenmeyen dosya türü."
        )
        
        contents = await file.read()

        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"{file.filename} dosyası 10 MB sınırını aşıyor.")
        await file.seek(0)

    all_rows = []
    warnings = []

    user_constraints = {
    "max_budget": safe_float_form(max_budget),
    "min_vade_days": safe_int_form(min_vade_days),
    "max_termin_days": safe_int_form(max_termin_days),
    "allow_missing_qty": allow_missing_qty == "true",

    "annual_interest_rate": annual_interest_rate,

    "critical_level": critical_level,
    "delay_impact": delay_impact,
    "alternative_stock": alternative_stock,

    "shipping_included": shipping_included,
    "shipping_cost": shipping_cost,

    "supplier_trust": supplier_trust,
    "quality_history": quality_history,

    "currency_risk": currency_risk
    }
    
    print("USER CONSTRAINTS:", user_constraints)
    print("SEÇİLEN TALEP DOSYASI:", request_file_name)
    print("SEÇİLEN TALEP PATH:", request_report_path)
    print("GELEN TEKLİF DOSYALARI:", [f.filename for f in files])

    if len(files) > 15:
        return {
            "success": False,
            "warnings": ["En fazla 15 dosya yükleyebilirsiniz."],
            "reportPath": None,
            "totalRows": 0,
            "totalGroups": 0,
        }

    firma_adlari = [
        x.strip()
        for x in firma_adlari_text.split(",")
        if x.strip()
    ]

    for i, upload in enumerate(files):
        firma_adi = os.path.splitext(upload.filename)[0].replace("_", " ").replace("-", " ").title()
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

            print("OKUNAN TEKLİF DOSYASI:", upload.filename)
            print("OKUNAN SATIR SAYISI:", len(rows))
            print("İLK SATIRLAR:", rows[:3])

            if not rows:
                warnings.append(f"Veri okunamadı: {upload.filename}")

            all_rows.extend(rows)

        except Exception as e:
            print("DOSYA HATASI:", upload.filename, str(e))
            warnings.append(f"Hata ({upload.filename}): {str(e)}")

    if not all_rows:
        return {
            "success": False,
            "warnings": warnings + ["Hiç teklif satırı okunamadı."],
            "reportPath": None,
            "totalRows": 0,
            "totalGroups": 0,
        }

    filtered = []

    for row in all_rows:
        has_code = bool(row.get("urunKodu"))
        has_desc = bool(row.get("urunAciklamasi"))

        try:
            has_price = float(row.get("birimFiyat", 0) or 0) > 0
        except Exception:
            has_price = False

        if (has_code or has_desc) and has_price:
            filtered.append(row)

    print("TOPLAM OKUNAN SATIR:", len(all_rows))
    print("FİLTRELENEN GEÇERLİ SATIR:", len(filtered))

    if not filtered:
        return {
            "success": False,
            "warnings": warnings + ["Geçerli ürün/fiyat satırı bulunamadı."],
            "reportPath": None,
            "totalRows": 0,
            "totalGroups": 0,
        }

    # --- TALEP LİSTESİNİ OKU ---
    request_items = []

    if request_report_path:
        request_file_path = os.path.join(
            TEMP_DIR,
            os.path.basename(request_report_path)
        )

        if os.path.exists(request_file_path):
            try:
                request_items = parse_request_file(request_file_path, request_file_name)
                print("TALEP SATIR SAYISI:", len(request_items))
            except Exception as e:
                print("TALEP DOSYASI OKUMA HATASI:", str(e))
                warnings.append(f"Talep dosyası okunamadı: {str(e)}")
        else:
            print("TALEP DOSYASI BULUNAMADI:", request_file_path)
            warnings.append("Talep dosyası bulunamadı, teklifler kendi içinde gruplanacak.")

    # --- GRUPLAMA ---
    if request_items:
        groups = match_offers_to_requests(filtered, request_items)

        matched_offer_ids = set()

        for g in groups:
            for o in g.get("offers", []):
                matched_offer_ids.add(id(o))

        unmatched_offers = [
            o for o in filtered
            if id(o) not in matched_offer_ids
        ]

        if unmatched_offers:
            warnings.append(
                f"{len(unmatched_offers)} teklif satırı talep listesiyle eşleşmedi, ayrıca rapora eklendi."
            )

            extra_groups = group_rows(unmatched_offers)
            groups.extend(extra_groups)

    else:
        groups = group_rows(filtered)

    print("FİRMALARA GÖRE SATIR SAYISI:")
    firma_debug = {}

    for r in filtered:
        firma = r.get("firma") or r.get("firmaAdi") or "Bilinmeyen"
        firma_debug[firma] = firma_debug.get(firma, 0) + 1

    print(firma_debug)
    print("OLUŞAN GRUP SAYISI:", len(groups))

    # --- KUR BİLGİSİ ---
    exchange_rates = {
        "TRY": 1.0,
        "USD": 39.2,
        "EUR": 42.8,
    }

    # --- ŞİRKET / KARAR MOTORU AYARLARI ---
    decision_config = {
        "annual_interest_rate": 45.0,
        "daily_delay_cost": 0.0,
        "missing_qty_penalty_multiplier": 1.25,
        "supplier_risk_rate": 0.0,
    }

    # --- KULLANICI ÖNCELİKLERİ ---
    user_preferences = {
        "price_weight": 50,
        "vade_weight": 20,
        "termin_weight": 20,
        "risk_weight": 10,
    }

    analyzed = analyze_groups(
        groups,
        exchange_rates,
        config=decision_config,
        constraints=user_constraints,
        preferences=user_preferences,
    )

    print("ANALİZ EDİLEN GRUP SAYISI:", len(analyzed))

    report_name = "mukayese_raporu.xlsx"
    report_path = os.path.join(TEMP_DIR, report_name)

    build_excel_report(analyzed, report_path)

    report_id = str(uuid.uuid4())

    report_record = {
     "id": report_id,
        "user_id": user_id,
        "ad": request_file_name or "Teklif Mukayese Raporu",
        "tarih": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "tur": "Mukayese",
        "durum": "Bekliyor",
        "onerilenfirma": find_best_supplier(analyzed),
        "reportpath": f"/download-report/{report_name}",
        "totalrows": len(filtered),
        "totalgroups": len(analyzed),
    }

    save_report_to_supabase(report_record)

    return {
    "success": True,
    "reportId": report_id,
    "reportPath": f"/download-report/{report_name}",
    "warnings": warnings,
    "totalRows": len(filtered),
    "totalGroups": len(analyzed),
    }

@app.get("/download-report/{file_name}")
def download_report(file_name: str):
    file_path = os.path.join(TEMP_DIR, file_name)

    if not os.path.exists(file_path):
        return {
            "success": False,
            "message": "Dosya bulunamadı."
        }

    return FileResponse(
        path=file_path,
        filename=file_name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

@app.post("/analyze-requests")
async def analyze_requests(
    files: list[UploadFile] = File(...),
    authorization: str = Header(None),
    ):
    all_rows = []
    warnings = []

    print("BACKEND GELEN TALEP DOSYALARI:", [upload.filename for upload in files])

    for upload in files:
        save_path = os.path.join(TEMP_DIR, upload.filename)

        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)

        try:
            rows = parse_request_file(save_path, upload.filename)

            print("OKUNAN TALEP DOSYASI:", upload.filename)
            print("OKUNAN TALEP SATIR SAYISI:", len(rows))
            print("OKUNAN TALEP SATIRLAR:", rows[:20])

            if not rows:
                warnings.append(f"Veri okunamadı: {upload.filename}")

            all_rows.extend(rows)

        except Exception as e:
            print("TALEP DOSYASI HATASI:", upload.filename, str(e))
            warnings.append(f"Hata ({upload.filename}): {str(e)}")

    if not all_rows:
        return {
            "success": False,
            "warnings": warnings + ["Talep dosyalarından okunabilir ürün bulunamadı."],
            "rows": [],
            "reportPath": None,
            "totalRows": 0
        }

    merged = {}
    auto_code_counter = 1

    for row in all_rows:
        kod = str(row.get("urunKodu", "") or "").strip()
        aciklama = str(row.get("urunAciklamasi", "") or "").strip()
        birim = str(row.get("birim", "adet") or "adet").strip().lower()
        adet_raw = row.get("talepEdilenAdet", 0)

        try:
            adet = float(str(adet_raw).replace(",", "."))
        except Exception:
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

        merge_key = find_merge_key(
            merged,
            kod_key,
            aciklama_key,
            birim_key
        )

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
            merged[merge_key]["talepEdilenAdet"] += adet

            if not merged[merge_key]["urunKodu"] and kod:
                merged[merge_key]["urunKodu"] = kod
                merged[merge_key]["_kodKey"] = kod_key

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

    build_request_excel_report(result_rows, report_path)

    with open(report_path, "rb") as f:
        supabase.storage.from_("request-reports").upload(
            report_name,
            f,
        {
                "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "x-upsert": "true"
        }
    )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header eksik veya geçersiz")
    
    token = authorization.replace("Bearer ", "").strip()

    user_response = supabase.auth.get_user(token)
    user_id = user_response.user.id 

    request_record = {
        "user_id": user_id,
        "ad": "Talep Listesi",
        "durum": "Oluşturuldu",
        "filepath": report_name,
        "totalitems": len(result_rows)
    }
    supabase.table("requests").insert(request_record).execute()

    signed = supabase.storage.from_("request-reports").create_signed_url(report_name, 3600)
    public_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
    print(public_url)

    return {
        "success": True,
        "warnings": warnings,
        "rows": result_rows,
        "reportPath": public_url,
        "totalRows": len(result_rows)
    }

@app.get("/download-request-report/{file_name}")
def download_request_report(file_name: str):
    signed = supabase.storage.from_("request-reports").create_signed_url(file_name, 3600)
    public_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")

    return {
        "success": True,
        "reportPath": public_url
    }

@app.get("/requests")
def get_requests():
    response = supabase.table("requests").select("*").order("created_at", desc=True).execute()

    return {
        "success": True,
        "requests": response.data
    }

@app.get("/reports")
def list_reports():
    return {
        "success": True,
        "reports": load_json(REPORTS_FILE)
    }

@app.get("/reports/{report_id}")
def get_report(report_id: str):
    reports = load_json(REPORTS_FILE)

    for report in reports:
        if report["id"] == report_id:
            return {
                "success": True,
                "report": report
            }

    return {
        "success": False,
        "message": "Rapor bulunamadı."
    }

@app.post("/reports/{report_id}/approve")
def approve_report(report_id: str):
    reports = load_json(REPORTS_FILE)

    for report in reports:
        if report["id"] == report_id:
            report["durum"] = "Tamamlandı"
            save_json(REPORTS_FILE, reports)
            return {
                "success": True,
                "report": report
            }

    return {
        "success": False,
        "message": "Rapor bulunamadı."
    }

@app.post("/reports/{report_id}/create-order")
def create_order_from_report(report_id: str):
    reports = load_json(REPORTS_FILE)
    orders = load_json(ORDERS_FILE)

    selected_report = None

    for report in reports:
        if report["id"] == report_id:
            selected_report = report
            break

    if not selected_report:
        return {
            "success": False,
            "message": "Rapor bulunamadı."
        }

    order = {
        "id": str(uuid.uuid4()),
        "siparisNo": f"SIP-{len(orders) + 1:04d}",
        "firma": selected_report.get("onerilenFirma", "-"),
        "urun": selected_report.get("ad", "Mukayese Raporu"),
        "miktar": "-",
        "siparisTarihi": datetime.now().strftime("%Y-%m-%d"),
        "termin": "-",
        "durum": "Bekliyor",
        "reportId": report_id,
    }

    orders.insert(0, order)
    save_json(ORDERS_FILE, orders)

    selected_report["durum"] = "Tamamlandı"
    save_json(REPORTS_FILE, reports)

    return {
        "success": True,
        "order": order
    }

@app.get("/orders")
def list_orders():
    return {
        "success": True,
        "orders": load_json(ORDERS_FILE)
    }

from fastapi.responses import Response

@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)