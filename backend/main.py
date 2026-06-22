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

from datetime import datetime, timezone

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Body
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.parsers.excel_parser import parse_excel, parse_excel_with_audit
from app.parsers.pdf_parser import parse_pdf, parse_pdf_with_audit, extract_pdf_ocr_result
from app.parsers.image_parser import (
    parse_image,
    extract_image_ocr_text,
    extract_document_items_from_text,
)
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


def normalize_request_items_payload(value):
    if not value:
        return []

    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except Exception:
        return []

    if not isinstance(parsed, list):
        return []

    rows = []

    for item in parsed:
        if not isinstance(item, dict):
            continue

        code = (
            item.get("urunKodu")
            or item.get("product_code")
            or item.get("productCode")
            or ""
        )
        description = (
            item.get("urunAciklamasi")
            or item.get("product_name")
            or item.get("productName")
            or item.get("description")
            or ""
        )
        quantity = (
            safe_float_form(item.get("talepEdilenAdet"))
            or safe_float_form(item.get("quantity"))
            or safe_float_form(item.get("estimated_quantity"))
            or safe_float_form(item.get("miktar"))
            or 0
        )

        if not description or quantity <= 0:
            continue

        rows.append({
            "urunKodu": str(code or "").strip(),
            "urunAciklamasi": str(description or "").strip(),
            "talepEdilenAdet": quantity,
            "birim": item.get("birim") or item.get("unit") or "adet",
            "kaynakDosya": item.get("kaynakDosya") or item.get("source_file") or "Seçili proje talebi",
            "kaynakTipi": "request_items_json",
        })

    return rows
    

def normalize_project_sections(raw_sections):
    normalized = []
    seen = set()

    for section in raw_sections:
        name = str(section.get("section_name") or "").strip().upper()
        total = safe_float_form(section.get("section_total")) or 0
        quantity = safe_float_form(section.get("section_quantity")) or 0
        compact_name = re.sub(r"[^A-Z0-9ÇĞİÖŞÜ]", "", name)

        if not compact_name or compact_name in ["TL", "TRY", "EUR", "USD"]:
            continue

        if total <= 0:
            continue

        key = (compact_name, round(total, 2))

        if key in seen:
            continue

        seen.add(key)
        normalized.append({
            "section_name": name,
            "section_total": total,
            "section_quantity": quantity,
        })

    return normalized


def normalize_offer_keyword(value):
    text = str(value or "").upper()
    replacements = {
        "İ": "I",
        "İ": "I",
        "Ğ": "G",
        "Ü": "U",
        "Ş": "S",
        "Ö": "O",
        "Ç": "C",
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    return re.sub(r"[^A-Z0-9]+", " ", text).strip()


def main_product_candidate_signal(row, code, name, unit_price, row_total, all_rows=None, index=0):
    text = normalize_offer_keyword(f"{code} {name} {row.get('section_name') or ''}")
    word_count = len([part for part in text.split(" ") if part])
    short_description = word_count <= 4 or len(text) <= 42
    has_total = row_total > 0 or safe_float_form(row.get("section_total")) > 0
    unit_price_empty = unit_price <= 0
    section_total_only = row.get("price_status") == "section_total_only" or bool(row.get("section_name"))
    quantity = safe_float_form(row.get("firmaAdedi")) or safe_float_form(row.get("talepEdilenAdet")) or 0
    low_quantity = 0 < quantity <= 2
    description_only = bool(text) and not code and unit_price_empty
    neighbors = (all_rows or [])[max(0, index - 3):index] + (all_rows or [])[index + 1:index + 4]
    priced_neighbors = 0

    for neighbor in neighbors:
        neighbor_price = (
            safe_float_form(neighbor.get("netBirimFiyat"))
            or safe_float_form(neighbor.get("netBirimFiyatDosyadan"))
            or safe_float_form(neighbor.get("birimFiyat"))
            or 0
        )
        neighbor_total = (
            safe_float_form(neighbor.get("netToplam"))
            or safe_float_form(neighbor.get("satirToplamDosyadan"))
            or 0
        )

        if neighbor_price > 0 or neighbor_total > 0:
            priced_neighbors += 1

    score = 0
    reasons = []

    if has_total:
        score += 2
        reasons.append("toplam fiyat içeriyor")
    if section_total_only:
        score += 3
        reasons.append("grup başlığı gibi görünüyor")
    if short_description:
        score += 1
        reasons.append("açıklama kısa")
    if unit_price_empty:
        score += 1
        reasons.append("birim fiyat boş veya 0")
    if low_quantity:
        score += 1
        reasons.append("adet düşük")
    if description_only:
        score += 1
        reasons.append("kod/fiyat yerine başlık metni gibi")
    if priced_neighbors >= 2:
        score += 1
        reasons.append("çevresinde ürün satırları var")

    return {
        "is_candidate": score >= 3,
        "score": score,
        "reasons": reasons,
    }


def safe_number_from_raw(value):
    parsed = safe_float_form(value)
    return parsed if parsed is not None else 0


def raw_item_text(raw_item):
    return normalize_offer_keyword(
        f"{raw_item.get('product_code') or ''} {raw_item.get('brand') or ''} {raw_item.get('description') or ''}"
    )


def raw_item_looks_like_material(raw_item):
    text = raw_item_text(raw_item)
    quantity = safe_number_from_raw(raw_item.get("quantity"))
    unit_price = safe_number_from_raw(raw_item.get("unit_price"))
    total = safe_number_from_raw(raw_item.get("total")) or safe_number_from_raw(raw_item.get("section_total"))
    price_status = raw_item.get("price_status") or ""

    if price_status == "section_total_only" or raw_item.get("section_name"):
        return False

    return bool(text and (quantity > 0 or unit_price > 0 or total > 0))


def score_main_product_candidate(raw_item, raw_items, index):
    text = raw_item_text(raw_item)
    words = [part for part in text.split(" ") if part]
    quantity = safe_number_from_raw(raw_item.get("quantity"))
    unit_price = safe_number_from_raw(raw_item.get("unit_price"))
    total = safe_number_from_raw(raw_item.get("total")) or safe_number_from_raw(raw_item.get("section_total"))
    section_total = safe_number_from_raw(raw_item.get("section_total"))
    price_status = raw_item.get("price_status") or ""
    raw_cells_text = normalize_offer_keyword(" ".join(str(cell) for cell in raw_item.get("raw_cells") or []))
    short_description = 0 < len(words) <= 5 or (0 < len(text) <= 48)
    unit_price_empty = unit_price <= 0
    has_total = total > 0
    quantity_one = quantity == 1 or (quantity <= 0 and (price_status == "section_total_only" or section_total > 0))
    code = str(raw_item.get("product_code") or "").strip()
    code_empty_or_short = len(normalize_offer_keyword(code).split()) <= 1 and len(code) <= 8
    description_only = bool(text) and not code and unit_price_empty
    section_total_like = price_status == "section_total_only" or bool(raw_item.get("section_name")) or section_total > 0
    raw_cells_total_like = bool(raw_cells_text and len(raw_cells_text.split()) <= 8 and has_total and unit_price_empty)
    neighbors = raw_items[max(0, index - 4):index] + raw_items[index + 1:index + 5]
    material_neighbors = sum(1 for item in neighbors if raw_item_looks_like_material(item))
    nearby_totals = [
        safe_number_from_raw(item.get("total")) or safe_number_from_raw(item.get("section_total"))
        for item in raw_items[index + 1:index + 9]
        if (safe_number_from_raw(item.get("total")) or safe_number_from_raw(item.get("section_total"))) > 0
    ]
    nearby_sum = sum(nearby_totals)
    group_total_like = has_total and len(nearby_totals) >= 2 and total >= nearby_sum * 0.75

    score = 0
    reasons = []

    if section_total_like:
        score += 6
        reasons.append("kategori / grup toplam satiri gibi")
    if has_total:
        score += 3
        reasons.append("satirda toplam fiyat var")
    if short_description:
        score += 2
        reasons.append("aciklama kisa / baslik gibi")
    if quantity_one:
        score += 2
        reasons.append("adet 1")
    if unit_price_empty:
        score += 3
        reasons.append("birim fiyat bos veya 0")
    if code_empty_or_short:
        score += 1
        reasons.append("kod bos veya kisa")
    if material_neighbors >= 3:
        score += 2
        reasons.append("cevresinde urun/malzeme satirlari var")
    elif material_neighbors >= 2:
        score += 1
        reasons.append("yakininda urun/malzeme satirlari var")
    if group_total_like:
        score += 2
        reasons.append("diger satirlara gore grup toplami gibi")
    if description_only:
        score += 1
        reasons.append("kod/fiyat yerine baslik metni gibi")
    if raw_cells_total_like:
        score += 1
        reasons.append("ham satir toplam/grup bilgisi tasiyor")

    if not section_total_like and unit_price > 0 and quantity > 1 and len(words) > 3:
        score -= 3
        reasons.append("normal malzeme satirina benziyor")

    confidence = min(98, max(25, int(round((score / 15) * 100))))

    return {
        "is_candidate": bool(text and score >= 4),
        "score": score,
        "confidence_score": confidence,
        "reasons": reasons,
    }


def token_similarity(left, right):
    left_tokens = set(raw_item_text(left).split())
    right_tokens = set(raw_item_text(right).split())

    if not left_tokens or not right_tokens:
        return 0

    return len(left_tokens & right_tokens) / max(len(left_tokens | right_tokens), 1)


def score_sub_item_for_main(raw_item, main_raw_item, raw_items, selected_raw_ids):
    raw_id = raw_item.get("id")

    if raw_id in selected_raw_ids:
        return None

    if not raw_item_looks_like_material(raw_item):
        return None

    row_index = safe_number_from_raw(raw_item.get("row_index"))
    main_index = safe_number_from_raw(main_raw_item.get("row_index"))
    distance = abs(row_index - main_index)
    score = 0
    reasons = []

    if raw_item.get("source_file") and raw_item.get("source_file") == main_raw_item.get("source_file"):
        score += 4
        reasons.append("aynı kaynak dosyada")

    if distance <= 4:
        score += 3
        reasons.append("ana ürüne yakın satırda")
    elif distance <= 10:
        score += 2
        reasons.append("ana ürüne orta yakınlıkta")
    elif distance <= 20:
        score += 1
        reasons.append("aynı bölgede olabilir")

    if row_index > main_index:
        score += 1
        reasons.append("ana üründen sonraki satır")

    raw_total = safe_number_from_raw(raw_item.get("total"))
    main_total = safe_number_from_raw(main_raw_item.get("total"))

    if raw_total > 0 and (safe_number_from_raw(raw_item.get("quantity")) > 0 or safe_number_from_raw(raw_item.get("unit_price")) > 0):
        score += 2
        reasons.append("ürün/malzeme satırı gibi")

    if main_total > 0 and raw_total > 0 and raw_total < main_total:
        score += 1
        reasons.append("ana ürün toplamından küçük tutar")

    similarity = token_similarity(raw_item, main_raw_item)

    if similarity >= 0.3:
        score += 1
        reasons.append("açıklama benzerliği var")

    confidence = min(95, max(25, int(round((score / 12) * 100))))

    return {
        "score": score,
        "confidence_score": confidence,
        "reasons": reasons,
        "distance": distance,
    }


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
SUPPLIERS_FILE = os.path.join(TEMP_DIR, "suppliers.json")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

def parse_license_datetime(value):
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def require_active_license(user_id: str):
    try:
        response = (
            supabase.table("user_licenses")
            .select("plan_type,license_status,trial_ends_at,expires_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        print("LICENSE CHECK ERROR:", str(exc))
        raise HTTPException(
            status_code=503,
            detail="Lisans bilgisi doğrulanamadı. Lütfen daha sonra tekrar deneyin.",
        )

    license_row = response.data[0] if response.data else None
    if not license_row or license_row.get("license_status") != "active":
        raise HTTPException(
            status_code=403,
            detail={"code": "LICENSE_EXPIRED", "message": "Demo veya lisans süresi sona erdi."},
        )

    now = datetime.now(timezone.utc)
    plan_type = license_row.get("plan_type")

    if plan_type == "demo":
        trial_ends_at = parse_license_datetime(license_row.get("trial_ends_at"))
        is_active = trial_ends_at is not None and trial_ends_at > now
    elif plan_type == "active":
        expires_at = parse_license_datetime(license_row.get("expires_at"))
        is_active = expires_at is None or expires_at > now
    else:
        is_active = False

    if not is_active:
        raise HTTPException(
            status_code=403,
            detail={"code": "LICENSE_EXPIRED", "message": "Demo veya lisans süresi sona erdi."},
        )

    return license_row


def verify_user_token(authorization: str, enforce_license: bool = True):
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

    if enforce_license:
        require_active_license(user["id"])

    return user


def resolve_company_info(user: dict) -> dict:
    user_id = str(user.get("id") or "").strip()
    metadata = user.get("user_metadata") or {}
    metadata_company_name = str(metadata.get("company_name") or "").strip()
    settings_row = None
    license_row = None

    if user_id:
        try:
            settings_response = (
                supabase.table("company_settings")
                .select("company_name,tax_no")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            settings_row = settings_response.data[0] if settings_response.data else None
        except Exception as exc:
            print("COMPANY SETTINGS LOOKUP ERROR:", str(exc))

        try:
            license_response = (
                supabase.table("user_licenses")
                .select("company_name")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            license_row = license_response.data[0] if license_response.data else None
        except Exception as exc:
            print("LICENSE COMPANY LOOKUP ERROR:", str(exc))

    company_name = (
        str((settings_row or {}).get("company_name") or "").strip()
        or metadata_company_name
        or str((license_row or {}).get("company_name") or "").strip()
        or "Firma adı belirtilmedi"
    )

    return {
        "company_name": company_name,
        "tax_no": str((settings_row or {}).get("tax_no") or "").strip(),
        "product_name": "Corvian ERP",
    }


def load_user_products_for_report(user_id: str) -> list[dict]:
    products = []
    page_size = 1000
    offset = 0

    while True:
        response = (
            supabase.table("products")
            .select("id,product_code,product_name,current_stock,reserved_stock")
            .eq("user_id", user_id)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = response.data or []
        products.extend(page)

        if len(page) < page_size:
            break
        offset += page_size

    return products

def load_json(path):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def user_scoped_rows(rows, user_id):
    return [
        row
        for row in rows
        if isinstance(row, dict) and row.get("user_id") == user_id
    ]

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

def normalize_supplier_payload(payload: dict, supplier_id: str | None = None):
    now = datetime.now().isoformat()
    on_time_rate = safe_int_form(payload.get("onTimeRate")) or 0
    delivery_score = safe_int_form(payload.get("deliveryScore")) or 4
    quality_score = safe_int_form(payload.get("qualityScore")) or 4
    price_score = safe_int_form(payload.get("priceScore")) or 4

    return {
        "id": supplier_id or payload.get("id") or str(uuid.uuid4()),
        "name": str(payload.get("name") or "").strip(),
        "category": payload.get("category") or "",
        "contact": payload.get("contact") or "",
        "phone": payload.get("phone") or "",
        "email": payload.get("email") or "",
        "city": payload.get("city") or "",
        "taxNo": payload.get("taxNo") or "",
        "address": payload.get("address") or "",
        "website": payload.get("website") or "",
        "paymentTerm": payload.get("paymentTerm") or "",
        "lastOrderDate": payload.get("lastOrderDate") or "",
        "totalOrders": safe_int_form(payload.get("totalOrders")) or 0,
        "onTimeRate": max(0, min(100, on_time_rate)),
        "productGroups": payload.get("productGroups") or "",
        "deliveryScore": max(1, min(5, delivery_score)),
        "qualityScore": max(1, min(5, quality_score)),
        "priceScore": max(1, min(5, price_score)),
        "status": payload.get("status") or "Aktif",
        "notes": payload.get("notes") or "",
        "createdAt": payload.get("createdAt") or now,
        "updatedAt": now,
    }

def normalized_lookup(value):
    return re.sub(r"\s+", " ", str(value or "").strip().lower())

def ensure_unique_supplier(suppliers, supplier, supplier_id: str | None = None):
    supplier_name = normalized_lookup(supplier.get("name"))
    supplier_tax_no = normalized_lookup(supplier.get("taxNo"))

    for existing in suppliers:
        existing_id = str(existing.get("id"))

        if supplier_id and existing_id == str(supplier_id):
            continue

        if supplier_name and normalized_lookup(existing.get("name")) == supplier_name:
            raise HTTPException(status_code=409, detail="Bu tedarikci adi zaten kayitli")

        if supplier_tax_no and normalized_lookup(existing.get("taxNo")) == supplier_tax_no:
            raise HTTPException(status_code=409, detail="Bu vergi no zaten kayitli")

def detect_file_type(filename: str) -> str:
    ext = filename.lower().split(".")[-1]

    if ext in ["xlsx", "xls", "xlsm", "xlsb", "csv", "ods"]:
        return "excel"

    if ext == "pdf":
        return "pdf"

    if ext in ["png", "jpg", "jpeg", "webp"]:
        return "image"

    return "unknown"


def parse_ocr_date(value: str):
    raw_value = str(value or "").strip()
    for date_format in ["%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"]:
        try:
            return datetime.strptime(raw_value, date_format).date().isoformat()
        except ValueError:
            continue
    return None


def parse_ocr_amount(value: str):
    raw_value = re.sub(r"\s+", "", str(value or ""))
    raw_value = re.sub(r"[^0-9,.-]", "", raw_value)
    if not raw_value:
        return None

    if "," in raw_value and "." in raw_value:
        if raw_value.rfind(",") > raw_value.rfind("."):
            raw_value = raw_value.replace(".", "").replace(",", ".")
        else:
            raw_value = raw_value.replace(",", "")
    elif "," in raw_value:
        decimal_length = len(raw_value.rsplit(",", 1)[-1])
        raw_value = raw_value.replace(".", "")
        raw_value = raw_value.replace(",", "." if decimal_length <= 2 else "")
    elif "." in raw_value:
        decimal_length = len(raw_value.rsplit(".", 1)[-1])
        if decimal_length > 2:
            raw_value = raw_value.replace(".", "")

    try:
        return float(raw_value)
    except ValueError:
        return None


def normalize_ocr_currency(value: str):
    currency = str(value or "").upper().strip()
    if currency in ["$", "USD"]:
        return "USD"
    if currency in ["€", "EUR"]:
        return "EUR"
    if currency in ["£", "GBP"]:
        return "GBP"
    return "TRY"


def extract_order_document_metadata(ocr_text: str):
    text_value = str(ocr_text or "")
    document_number = None
    document_date = None
    invoice_total = None
    currency = "TRY"

    number_match = re.search(
        r"(?:fatura|irsaliye|belge|invoice|document|seri)\s*"
        r"(?:no|numarasi|numarası|number|#)?\s*[:\-]?\s*"
        r"([A-Z0-9][A-Z0-9./\-_]{2,})",
        text_value,
        re.IGNORECASE,
    )
    if number_match:
        document_number = number_match.group(1).strip()

    date_match = re.search(
        r"(?:tarih|date)\s*[:\-]?\s*"
        r"(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{1,2}-\d{1,2})",
        text_value,
        re.IGNORECASE,
    )
    if not date_match:
        date_match = re.search(
            r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{1,2}-\d{1,2})\b",
            text_value,
        )
    if date_match:
        document_date = parse_ocr_date(date_match.group(1))

    total_matches = list(re.finditer(
        r"(?:genel\s+toplam|ödenecek\s+tutar|odenecek\s+tutar|"
        r"fatura\s+toplamı|fatura\s+toplami|grand\s+total|toplam)\s*[:\-]?\s*"
        r"(?P<prefix>TRY|TL|USD|EUR|GBP|₺|\$|€|£)?\s*"
        r"(?P<amount>\d[\d\s.,]*\d|\d)\s*"
        r"(?P<suffix>TRY|TL|USD|EUR|GBP|₺|\$|€|£)?",
        text_value,
        re.IGNORECASE,
    ))
    total_match = total_matches[-1] if total_matches else None
    if total_match:
        invoice_total = parse_ocr_amount(total_match.group("amount"))
        currency = normalize_ocr_currency(
            total_match.group("prefix") or total_match.group("suffix") or "TRY"
        )
    else:
        currency_match = re.search(r"\b(TRY|TL|USD|EUR|GBP)\b|[₺$€£]", text_value)
        if currency_match:
            currency = normalize_ocr_currency(currency_match.group(0))

    return {
        "document_number": document_number,
        "document_date": document_date,
        "supplier_name": None,
        "supplier_tax_number": None,
        "invoice_total": invoice_total,
        "currency": currency,
    }

MAX_UPLOAD_FILES = 15
MAX_UPLOAD_SIZE = 10 * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".xlsm", ".xlsb", ".csv", ".ods", ".png", ".jpg", ".jpeg", ".webp"}

def safe_upload_name(filename: str) -> str:
    original_name = os.path.basename(filename or "dosya")
    stem, ext = os.path.splitext(original_name)
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-") or "dosya"
    return f"{uuid.uuid4()}_{safe_stem[:80]}{ext.lower()}"

async def save_upload_file(upload: UploadFile) -> tuple[str | None, str | None, str | None]:
    original_name = os.path.basename(upload.filename or "dosya")
    ext = os.path.splitext(original_name)[1].lower()

    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        return None, original_name, f"Desteklenmeyen dosya: {original_name}"

    contents = await upload.read()

    if len(contents) > MAX_UPLOAD_SIZE:
        return None, original_name, f"{original_name} dosyasi 10 MB sinirini asiyor."

    safe_name = safe_upload_name(original_name)
    save_path = os.path.join(TEMP_DIR, safe_name)

    with open(save_path, "wb") as buffer:
        buffer.write(contents)

    return save_path, original_name, None

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


@app.post("/order-documents/ocr")
async def analyze_order_document_ocr(
    file: UploadFile = File(...),
    authorization: str = Header(None),
):
    verify_user_token(authorization)
    save_path = None

    try:
        save_path, original_name, upload_error = await save_upload_file(file)
        if upload_error:
            raise HTTPException(status_code=400, detail=upload_error)

        extension = os.path.splitext(original_name)[1].lower()
        if extension not in {".pdf", ".jpg", ".jpeg", ".png"}:
            raise HTTPException(
                status_code=400,
                detail="Sipariş belgesi OCR için yalnızca PDF, JPG ve PNG desteklenir.",
            )

        file_type = detect_file_type(original_name)
        if file_type == "pdf":
            ocr_text, extraction_method, document_items = await run_in_threadpool(
                extract_pdf_ocr_result, save_path
            )
        elif file_type == "image":
            ocr_text = await run_in_threadpool(extract_image_ocr_text, save_path)
            extraction_method = "tesseract-regex"
            document_items = extract_document_items_from_text(ocr_text)
        else:
            raise HTTPException(status_code=400, detail="Desteklenmeyen belge türü.")

        if not str(ocr_text or "").strip():
            raise HTTPException(
                status_code=422,
                detail="Belgeden okunabilir metin çıkarılamadı.",
            )

        metadata = extract_order_document_metadata(ocr_text)
        return {
            "source": "tesseract-pdfplumber",
            "document_type": "unknown",
            **metadata,
            "ocr_text": ocr_text,
            "ocr_confidence": None,
            "items": document_items,
            "items_extraction_method": extraction_method,
            "items_count": len(document_items),
        }
    except HTTPException:
        raise
    except Exception as error:
        print("ORDER DOCUMENT OCR ERROR:", str(error))
        raise HTTPException(
            status_code=422,
            detail=f"Belge OCR analizi başarısız: {str(error)}",
        ) from error
    finally:
        if save_path and os.path.exists(save_path):
            try:
                os.remove(save_path)
            except OSError:
                pass


@app.post("/suggest-main-products")
async def suggest_main_products(
    payload: dict = Body(...),
    authorization: str = Header(None),
):
    verify_user_token(authorization)

    raw_items = payload.get("raw_items") or payload.get("rawItems") or []

    if not isinstance(raw_items, list):
        return {
            "success": False,
            "warnings": ["raw_items listesi bekleniyor."],
            "main_product_candidates": [],
        }

    candidates = []

    for index, raw_item in enumerate(raw_items):
        if not isinstance(raw_item, dict):
            continue

        signal = score_main_product_candidate(raw_item, raw_items, index)

        if not signal["is_candidate"]:
            continue

        title = (
            str(raw_item.get("description") or "").strip()
            or str(raw_item.get("product_code") or "").strip()
            or f"Satır {raw_item.get('row_index') or index + 1}"
        )

        candidates.append({
            "id": f"candidate-{len(candidates) + 1}",
            "raw_item_id": raw_item.get("id") or f"raw-{index + 1}",
            "title": title,
            "estimated_total": safe_number_from_raw(raw_item.get("total")) or safe_number_from_raw(raw_item.get("section_total")),
            "confidence_score": signal["confidence_score"],
            "score": signal.get("score", 0),
            "reasons": signal["reasons"],
            "selected": False,
            "row_index": raw_item.get("row_index") or index + 1,
            "source_file": raw_item.get("source_file") or "",
            "price_status": raw_item.get("price_status") or "",
        })

    candidates.sort(key=lambda item: (-item.get("confidence_score", 0), -safe_number_from_raw(item.get("estimated_total")), item.get("row_index") or 0))

    return {
        "success": True,
        "warnings": [],
        "main_product_candidates": candidates,
        "totalCandidates": len(candidates),
    }


@app.post("/suggest-product-hierarchy")
async def suggest_product_hierarchy(
    payload: dict = Body(...),
    authorization: str = Header(None),
):
    verify_user_token(authorization)

    raw_items = payload.get("raw_items") or payload.get("rawItems") or []
    selected_main_products = payload.get("selected_main_products") or payload.get("selectedMainProducts") or []

    if not isinstance(raw_items, list) or not isinstance(selected_main_products, list):
        return {
            "success": False,
            "warnings": ["raw_items ve selected_main_products listesi bekleniyor."],
            "hierarchy_groups": [],
        }

    raw_by_id = {
        str(item.get("id")): item
        for item in raw_items
        if isinstance(item, dict) and item.get("id")
    }
    selected_raw_ids = set()
    main_items = []

    for selected in selected_main_products:
        raw_item_id = selected.get("raw_item_id") if isinstance(selected, dict) else selected
        raw_item = raw_by_id.get(str(raw_item_id))

        if raw_item:
            selected_raw_ids.add(str(raw_item.get("id")))
            main_items.append(raw_item)

    hierarchy_groups = []

    for main_index, main_item in enumerate(main_items):
        scored_sub_items = []

        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                continue

            signal = score_sub_item_for_main(raw_item, main_item, raw_items, selected_raw_ids)

            if not signal or signal["score"] < 4:
                continue

            scored_sub_items.append({
                "raw_item_id": raw_item.get("id"),
                "title": raw_item.get("description") or raw_item.get("product_code") or "-",
                "product_code": raw_item.get("product_code") or "",
                "brand": raw_item.get("brand") or "",
                "quantity": safe_number_from_raw(raw_item.get("quantity")),
                "unit": raw_item.get("unit") or "",
                "unit_price": safe_number_from_raw(raw_item.get("unit_price")),
                "total": safe_number_from_raw(raw_item.get("total")),
                "currency": raw_item.get("currency") or "TRY",
                "suggestion_score": signal["confidence_score"],
                "reasons": signal["reasons"],
                "_distance": signal["distance"],
            })

        scored_sub_items.sort(key=lambda item: (-item["suggestion_score"], item["_distance"]))
        cleaned_sub_items = [
            {key: value for key, value in item.items() if key != "_distance"}
            for item in scored_sub_items[:50]
        ]
        average_score = (
            int(round(sum(item["suggestion_score"] for item in cleaned_sub_items) / len(cleaned_sub_items)))
            if cleaned_sub_items
            else 0
        )

        hierarchy_groups.append({
            "id": f"group-{main_index + 1}",
            "main_product": {
                "raw_item_id": main_item.get("id"),
                "title": main_item.get("description") or main_item.get("product_code") or f"Ana Ürün {main_index + 1}",
                "estimated_total": safe_number_from_raw(main_item.get("total")),
            },
            "sub_items": cleaned_sub_items,
            "suggestion_score": average_score,
            "user_confirmed": False,
        })

    return {
        "success": True,
        "warnings": [],
        "hierarchy_groups": hierarchy_groups,
    }


@app.post("/project-items/bulk-delete")
async def bulk_delete_project_items(
    payload: dict = Body(...),
    authorization: str = Header(None),
):
    user = verify_user_token(authorization)
    user_id = user.get("id")
    project_id = str(payload.get("project_id") or "").strip()
    selected_ids = [str(item_id).strip() for item_id in payload.get("selected_ids") or [] if str(item_id or "").strip()]
    batch_size = int(payload.get("batch_size") or 50)
    batch_size = max(1, min(batch_size, 100))

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id eksik")

    if not selected_ids:
        raise HTTPException(status_code=400, detail="Silinecek urun secilmedi")

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase servis ayarlari eksik")

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }

    def chunks(values, size):
        for start in range(0, len(values), size):
            yield values[start:start + size]

    def unique(values):
        result = []
        seen = set()
        for value in values:
            if value and value not in seen:
                seen.add(value)
                result.append(value)
        return result

    def select_project_items(extra_params=None):
        params = {
            "project_id": f"eq.{project_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,parent_item_id",
        }
        if extra_params:
            params.update(extra_params)

        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/project_items",
            headers=headers,
            params=params,
            timeout=30,
        )

        if response.status_code >= 400:
            print("PROJECT ITEM SELECT ERROR:", response.status_code, response.text)
            raise HTTPException(status_code=400, detail=response.text or "Proje urunleri okunamadi")

        return response.json() or []

    project_items = select_project_items()
    known_ids = {str(item.get("id")) for item in project_items if item.get("id")}
    selected_ids = unique([item_id for item_id in selected_ids if item_id in known_ids])

    print("BULK DELETE selected id count:", len(selected_ids))

    if not selected_ids:
        raise HTTPException(status_code=400, detail="Secili urunler proje listesinde bulunamadi")

    children_by_parent = {}
    for item in project_items:
        parent_id = item.get("parent_item_id")
        item_id = item.get("id")
        if parent_id and item_id:
            children_by_parent.setdefault(str(parent_id), []).append(str(item_id))

    descendant_ids = []
    visited_ids = set()

    def collect_descendants(parent_id):
        for child_id in children_by_parent.get(parent_id, []):
            if child_id in visited_ids:
                continue
            visited_ids.add(child_id)
            collect_descendants(child_id)
            descendant_ids.append(child_id)

    for item_id in selected_ids:
        collect_descendants(item_id)

    descendant_ids = unique([item_id for item_id in descendant_ids if item_id in known_ids])
    selected_remaining_ids = unique([item_id for item_id in selected_ids if item_id not in set(descendant_ids)])

    print("BULK DELETE child id count:", len(descendant_ids))

    deleted_ids = []
    batch_logs = []

    def delete_batch(label, ids):
        nonlocal deleted_ids
        if not ids:
            return

        for batch_index, batch_ids in enumerate(chunks(ids, batch_size), start=1):
            response = requests.delete(
                f"{SUPABASE_URL}/rest/v1/project_items",
                headers={**headers, "Prefer": "return=representation"},
                params={
                    "project_id": f"eq.{project_id}",
                    "user_id": f"eq.{user_id}",
                    "id": f"in.({','.join(batch_ids)})",
                    "select": "id",
                },
                timeout=30,
            )

            if response.status_code >= 400:
                print("BULK DELETE batch error:", label, batch_index, response.status_code, response.text)
                raise HTTPException(status_code=400, detail=response.text or f"{label} batch silinemedi")

            deleted_rows = response.json() if response.text else []
            deleted_batch_ids = [row.get("id") for row in deleted_rows if row.get("id")]
            deleted_ids.extend(deleted_batch_ids)
            log = {
                "label": label,
                "batch": batch_index,
                "attempted": len(batch_ids),
                "deleted": len(deleted_batch_ids),
            }
            batch_logs.append(log)
            print("BULK DELETE batch result:", log)

    delete_batch("children", descendant_ids)
    delete_batch("selected", selected_remaining_ids)

    attempted_ids = unique([*descendant_ids, *selected_ids])
    remaining_items = []
    for batch_ids in chunks(attempted_ids, batch_size):
        remaining_items.extend(select_project_items({"id": f"in.({','.join(batch_ids)})"}))

    remaining_ids = [item.get("id") for item in remaining_items if item.get("id")]
    print("BULK DELETE remaining count:", len(remaining_ids))

    return {
        "success": True,
        "deleted_ids": unique(deleted_ids),
        "deleted_count": len(unique(deleted_ids)),
        "attempted_count": len(attempted_ids),
        "selected_count": len(selected_ids),
        "child_count": len(descendant_ids),
        "remaining_ids": remaining_ids,
        "remaining_count": len(remaining_ids),
        "batch_logs": batch_logs,
    }


@app.post("/parse-project-items")
async def parse_project_items(
    files: list[UploadFile] = File(...),
    authorization: str = Header(None),
):
    verify_user_token(authorization)

    if len(files) > MAX_UPLOAD_FILES:
        return {
            "success": False,
            "warnings": ["En fazla 15 dosya yukleyebilirsiniz."],
            "rows": [],
            "totalRows": 0,
        }

    all_rows = []
    sections = []
    warnings = []
    blocking_errors = []
    parser_debug = []

    for upload in files:
        save_path, original_name, upload_error = await save_upload_file(upload)
        if upload_error:
            warnings.append(upload_error)
            continue

        try:
            file_type = detect_file_type(original_name)
            fallback_name = os.path.splitext(original_name)[0].replace("_", " ").replace("-", " ").title()

            if file_type == "excel":
                audit = parse_excel_with_audit(save_path, fallback_name, original_name)
                rows = audit["rows"]
                sections.extend(audit.get("sections", []))
                blocking_errors.extend(audit.get("errors", []))
                warnings.extend(audit.get("warnings", []))
                parser_debug.extend(audit.get("debug", []))
            elif file_type == "pdf":
                audit = parse_pdf_with_audit(save_path, fallback_name, original_name)
                rows = audit["rows"]
                sections.extend(audit.get("sections", []))
                blocking_errors.extend(audit.get("errors", []))
                warnings.extend(audit.get("warnings", []))
                parser_debug.extend(audit.get("debug", []))
            elif file_type == "image":
                rows = parse_image(save_path, fallback_name, original_name)
            else:
                rows = []

            if not rows and file_type != "pdf":
                rows = parse_request_file(save_path, original_name)

            print("OKUNAN PROJE MALZEME DOSYASI:", original_name)
            print("OKUNAN PROJE MALZEME SATIR SAYISI:", len(rows))
            print("OKUNAN PROJE MALZEME ILK SATIRLAR:", rows[:5])

            if not rows:
                warnings.append(f"Veri okunamadi: {original_name}")

            all_rows.extend(rows)
        except Exception as e:
            print("PROJE MALZEME DOSYASI HATASI:", original_name, str(e))
            warnings.append(f"Hata ({original_name}): {str(e)}")

    auto_code_counter = 1
    result_rows = []
    raw_items = []

    for index, row in enumerate(all_rows):
        code = str(row.get("urunKodu") or "").strip().upper()
        name = str(row.get("urunAciklamasi") or "").strip()
        unit = str(row.get("birim") or "adet").strip().lower() or "adet"

        quantity = safe_float_form(row.get("firmaAdedi"))
        if quantity is None:
            quantity = safe_float_form(row.get("talepEdilenAdet")) or 0

        unit_price = (
            safe_float_form(row.get("netBirimFiyat"))
            or safe_float_form(row.get("netBirimFiyatDosyadan"))
            or safe_float_form(row.get("birimFiyat"))
            or 0
        )
        original_unit_price = unit_price

        row_total = (
            safe_float_form(row.get("netToplam"))
            or safe_float_form(row.get("satirToplamDosyadan"))
            or 0
        )
        price_status = row.get("price_status") or "line_priced"

        if price_status not in ["line_priced", "flat_main_item"] or row.get("section_name"):
            price_status = "section_total_only"
            unit_price = 0
            row_total = 0

        if row_total > 0 and quantity > 0 and unit_price <= 0:
            unit_price = row_total / quantity

        raw_cells = row.get("raw_cells") or row.get("rawCells") or row.get("cells")

        if not raw_cells:
            raw_cells = [value for value in row.values() if value not in [None, ""]]

        section_total = safe_float_form(row.get("section_total")) or 0
        raw_quantity = quantity
        raw_total = row_total if row_total > 0 else quantity * unit_price

        if price_status == "section_total_only":
            raw_quantity = quantity if quantity > 0 else 1
            raw_total = section_total or safe_float_form(row.get("satirToplamDosyadan")) or safe_float_form(row.get("netToplam")) or raw_total

        raw_items.append({
            "id": f"raw-{index + 1}",
            "source_file": row.get("kaynakDosya") or "",
            "source_type": row.get("kaynakTipi") or "",
            "row_index": index + 1,
            "raw_cells": raw_cells,
            "product_code": code,
            "brand": row.get("marka") or row.get("brand") or "",
            "description": name,
            "quantity": raw_quantity,
            "unit": unit,
            "unit_price": unit_price,
            "total": raw_total,
            "currency": row.get("paraBirimi") or row.get("currency") or "TRY",
            "section_name": row.get("section_name") or "",
            "section_total": section_total,
            "section_quantity": safe_float_form(row.get("section_quantity")) or 0,
            "price_status": price_status,
        })

        if not name or quantity <= 0:
            continue

        if not code:
            code = f"PRJ-{auto_code_counter:04d}"
            auto_code_counter += 1

        result_rows.append({
            "product_code": code,
            "product_name": name,
            "unit": unit,
            "estimated_quantity": quantity,
            "estimated_unit_price": unit_price,
            "estimated_total": row_total if row_total > 0 else quantity * unit_price,
            "status": "Bekliyor",
            "note": row.get("firmaAdi") or row.get("firma") or "",
            "source_file": row.get("kaynakDosya") or "",
            "source_type": row.get("kaynakTipi") or "",
            "section_name": row.get("section_name") or "",
            "section_total": row.get("section_total") or 0,
            "section_quantity": row.get("section_quantity") or 0,
            "price_status": price_status,
        })

    sections = normalize_project_sections(sections)

    if not result_rows:
        return {
            "success": False,
            "warnings": warnings + ["Dosyalardan projeye aktarilabilir urun bulunamadi."],
            "rows": [],
            "raw_items": raw_items,
            "rawItems": raw_items,
            "sections": sections,
            "debug": parser_debug,
            "totalRows": 0,
        }

    if blocking_errors:
        return {
            "success": False,
            "warnings": ["Dosya aktarima kilitlendi."] + blocking_errors,
            "rows": result_rows,
            "raw_items": raw_items,
            "rawItems": raw_items,
            "sections": sections,
            "debug": parser_debug,
            "totalRows": len(result_rows),
        }

    return {
        "success": True,
        "warnings": warnings,
        "rows": result_rows,
        "raw_items": raw_items,
        "rawItems": raw_items,
        "sections": sections,
        "debug": parser_debug,
        "totalRows": len(result_rows),
    }

@app.post("/analyze-offers")
async def analyze_offers(
    files: list[UploadFile] = File(...),
    firma_adlari_text: str = Form(""),
    request_id: str = Form(""),
    project_id: str = Form(""),
    request_report_path: str = Form(""),
    request_file_name: str = Form(""),
    request_items_json: str = Form(""),

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
    exchange_rates_json: str = Form(""),

):
    user = verify_user_token(authorization)
    user_id = user["id"]

    if len(files) > MAX_UPLOAD_FILES:
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
        save_path, original_name, upload_error = await save_upload_file(upload)
        if upload_error:
            warnings.append(upload_error)
            continue

        firma_adi = os.path.splitext(original_name)[0].replace("_", " ").replace("-", " ").title()
        file_type = detect_file_type(original_name)

        try:
            if file_type == "excel":
                audit = parse_excel_with_audit(save_path, firma_adi, original_name)
                rows = audit["rows"]
                warnings.extend(audit.get("warnings", []))
                warnings.extend(audit.get("errors", []))

            elif file_type == "pdf":
                audit = parse_pdf_with_audit(save_path, firma_adi, original_name)
                rows = audit["rows"]
                warnings.extend(audit.get("warnings", []))
                warnings.extend(audit.get("errors", []))

            elif file_type == "image":
                rows = parse_image(save_path, firma_adi, original_name)

            else:
                rows = []
                warnings.append(f"Desteklenmeyen dosya: {original_name}")

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

    request_items = normalize_request_items_payload(request_items_json)

    if request_items:
        print("SEÇİLEN TALEP JSON SATIR SAYISI:", len(request_items))

    if not request_items and request_report_path:
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

    if exchange_rates_json:
        try:
            submitted_rates = json.loads(exchange_rates_json)
            for currency in ["USD", "EUR", "GBP"]:
                rate = safe_float_form(submitted_rates.get(currency))
                if rate and rate > 0:
                    exchange_rates[currency] = rate
        except Exception as e:
            print("KUR BILGISI OKUNAMADI:", str(e))
            warnings.append("Kur bilgisi okunamadı, varsayılan kurlar kullanıldı.")

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

    report_id = str(uuid.uuid4())
    report_name = f"mukayese_raporu_{report_id}.xlsx"
    report_path = os.path.join(TEMP_DIR, report_name)

    build_excel_report(analyzed, report_path, resolve_company_info(user))

    order_items = []
    for group in analyzed:
        best = (
            group.get("best")
            or group.get("bestOffer")
            or group.get("onerilenTeklif")
            or {}
        )

        request_item = (
            group.get("requestItem")
            or group.get("request")
            or group.get("talep")
            or {}
        )

        order_items.append({
            "productCode": group.get("urunKodu") or request_item.get("urunKodu") or best.get("urunKodu") or "",
            "productName": group.get("urunAciklamasi") or request_item.get("urunAciklamasi") or best.get("urunAciklamasi") or "",
            "quantity": group.get("talepEdilenAdet") or request_item.get("talepEdilenAdet") or best.get("talepEdilenAdet") or 0,
            "unit": group.get("birim") or request_item.get("birim") or best.get("birim") or "adet",
            "selectedFirm": best.get("firmaAdi") or best.get("firma") or "",
            "unitPrice": best.get("birimFiyat") or 0,
            "discount": best.get("iskonto") or 0,
            "netUnitPrice": best.get("netBirimFiyat") or 0,
            "total": best.get("netToplam") or best.get("netToplamTRY") or best.get("toplamTutar") or 0,
            "paymentTerm": best.get("vade") or "",
            "deliveryTerm": best.get("termin") or "",
        })
        
    print("ORDER ITEMS SAYISI:", len(order_items))
    print("ORDER ITEMS:", order_items)

    report_record = {
        "id": report_id,
        "user_id": user_id,
        "project_id": project_id if project_id else None,
        "ad": request_file_name or "Teklif Mukayese Raporu",
        "tarih": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "tur": "Mukayese",
        "durum": "Bekliyor",
        "onerilenfirma": find_best_supplier(analyzed),
        "reportpath": f"/download-report/{report_name}",
        "totalrows": len(filtered),
        "totalgroups": len(analyzed),
        "analysis": analyzed,
        "items": order_items,
    }

    offer_groups = {}

    for row in filtered:
        dosya_adi = row.get("kaynakDosya") or row.get("dosyaAdi") or "Bilinmeyen dosya"
        firma_adi = row.get("firma") or row.get("firmaAdi") or os.path.splitext(dosya_adi)[0]

        if dosya_adi not in offer_groups:
            offer_groups[dosya_adi] = {
                "firma_adi": firma_adi,
                "dosya_adi": dosya_adi,
                "toplam_tutar": 0,
                "para_birimi": row.get("paraBirimi") or "TRY",
                "satir_sayisi": 0,
            }

        offer_groups[dosya_adi]["satir_sayisi"] += 1
        offer_groups[dosya_adi]["toplam_tutar"] += safe_float_form(
            row.get("netToplam") or row.get("toplamTutar") or 0
        )

    for offer in offer_groups.values():
        offer_record = {
            "user_id": user_id,
            "request_id": request_id if request_id else None,
            "project_id": project_id if project_id else None,
            "firma_adi": offer["firma_adi"],
            "dosya_adi": offer["dosya_adi"],
            "para_birimi": offer["para_birimi"],
            "toplam_tutar": offer["toplam_tutar"],
            "durum": "Analiz edildi",
        }

        supabase.table("offers").insert(offer_record).execute()

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
def download_report(file_name: str, authorization: str = Header(None)):
    user = verify_user_token(authorization)
    user_id = user["id"]

    safe_file_name = os.path.basename(file_name)
    report_path_value = f"/download-report/{safe_file_name}"

    response = (
        supabase.table("reports")
        .select("id")
        .eq("user_id", user_id)
        .eq("reportpath", report_path_value)
        .limit(1)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=403, detail="Bu raporu indirme yetkiniz yok.")

    file_path = os.path.join(TEMP_DIR, safe_file_name)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dosya bulunamadı.")

    return FileResponse(
        path=file_path,
        filename=safe_file_name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

@app.post("/analyze-requests")
async def analyze_requests(
    files: list[UploadFile] = File(...),
    authorization: str = Header(None),
    ):
    user = verify_user_token(authorization)
    user_id = user["id"]

    all_rows = []
    warnings = []

    print("BACKEND GELEN TALEP DOSYALARI:", [upload.filename for upload in files])

    if len(files) > MAX_UPLOAD_FILES:
        return {
            "success": False,
            "warnings": ["En fazla 15 dosya yukleyebilirsiniz."],
            "rows": [],
            "reportPath": None,
            "totalRows": 0
        }

    for upload in files:
        save_path, original_name, upload_error = await save_upload_file(upload)
        if upload_error:
            warnings.append(upload_error)
            continue

        try:
            rows = parse_request_file(save_path, original_name)

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

    report_name = f"talep_listesi_{user_id}_{uuid.uuid4()}.xlsx"
    report_path = os.path.join(TEMP_DIR, report_name)

    try:
        report_products = load_user_products_for_report(user_id)
    except Exception as exc:
        print("REQUEST REPORT PRODUCT LOOKUP ERROR:", str(exc))
        warnings.append("Stok kartları okunamadığı için raporda ürünler eşleşmemiş olarak gösterildi.")
        report_products = []

    build_request_excel_report(
        result_rows,
        report_path,
        resolve_company_info(user),
        report_products,
    )

    with open(report_path, "rb") as f:
        supabase.storage.from_("request-reports").upload(
            report_name,
            f,
        {
                "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "x-upsert": "true"
        }
    )
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
def download_request_report(file_name: str, authorization: str = Header(None)):
    user = verify_user_token(authorization)
    user_id = user["id"]
    safe_file_name = os.path.basename(file_name)

    response = (
        supabase.table("requests")
        .select("id")
        .eq("user_id", user_id)
        .eq("filepath", safe_file_name)
        .limit(1)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=403, detail="Bu talep dosyasını indirme yetkiniz yok.")

    signed = supabase.storage.from_("request-reports").create_signed_url(safe_file_name, 600)
    public_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")

    return {
        "success": True,
        "reportPath": public_url
    }

@app.get("/requests")
def get_requests(authorization: str = Header(None)):

    user = verify_user_token(authorization)
    user_id = user["id"]

    response = (
        supabase.table("requests")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )

    formatted_requests = []

    for row in response.data:
        formatted_requests.append({
            "id": row["id"],
            "ad": row.get("ad"),
            "durum": row.get("durum"),
            "filepath": row.get("filepath"),
            "fileName": row.get("filepath"),
            "createdAt": row.get("created_at"),
            "totalitems": row.get("totalitems")
        })

    return {
        "success": True,
        "requests": formatted_requests
    }

@app.get("/reports")
def list_reports(authorization: str = Header(None)):
    user = verify_user_token(authorization)
    return {
        "success": True,
        "reports": user_scoped_rows(load_json(REPORTS_FILE), user["id"])
    }

@app.get("/reports/{report_id}")
def get_report(report_id: str, authorization: str = Header(None)):
    user = verify_user_token(authorization)
    reports = user_scoped_rows(load_json(REPORTS_FILE), user["id"])

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
def approve_report(report_id: str, authorization: str = Header(None)):
    user = verify_user_token(authorization)
    reports = load_json(REPORTS_FILE)

    for report in reports:
        if report["id"] == report_id and report.get("user_id") == user["id"]:
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
def create_order_from_report(report_id: str, authorization: str = Header(None)):
    user = verify_user_token(authorization)
    reports = load_json(REPORTS_FILE)
    orders = load_json(ORDERS_FILE)

    selected_report = None

    for report in reports:
        if report["id"] == report_id and report.get("user_id") == user["id"]:
            selected_report = report
            break

    if not selected_report:
        return {
            "success": False,
            "message": "Rapor bulunamadı."
        }

    order = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
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
def list_orders(authorization: str = Header(None)):
    user = verify_user_token(authorization)
    return {
        "success": True,
        "orders": user_scoped_rows(load_json(ORDERS_FILE), user["id"])
    }

@app.get("/suppliers")
def list_suppliers(authorization: str = Header(None)):
    user = verify_user_token(authorization)
    return {
        "success": True,
        "suppliers": user_scoped_rows(load_json(SUPPLIERS_FILE), user["id"])
    }

@app.post("/suppliers")
def create_supplier(payload: dict = Body(...), authorization: str = Header(None)):
    user = verify_user_token(authorization)
    supplier = normalize_supplier_payload(payload)
    supplier["user_id"] = user["id"]

    if not supplier["name"]:
        raise HTTPException(status_code=400, detail="Tedarikci adi zorunlu")

    suppliers = load_json(SUPPLIERS_FILE)
    ensure_unique_supplier(user_scoped_rows(suppliers, user["id"]), supplier)
    suppliers.insert(0, supplier)
    save_json(SUPPLIERS_FILE, suppliers)

    return {
        "success": True,
        "supplier": supplier
    }

@app.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: str, payload: dict = Body(...), authorization: str = Header(None)):
    user = verify_user_token(authorization)
    suppliers = load_json(SUPPLIERS_FILE)

    for index, supplier in enumerate(suppliers):
        if str(supplier.get("id")) == supplier_id and supplier.get("user_id") == user["id"]:
            updated = normalize_supplier_payload(
                {**supplier, **payload},
                supplier_id=supplier_id,
            )
            updated["user_id"] = user["id"]

            if not updated["name"]:
                raise HTTPException(status_code=400, detail="Tedarikci adi zorunlu")

            ensure_unique_supplier(user_scoped_rows(suppliers, user["id"]), updated, supplier_id=supplier_id)
            suppliers[index] = updated
            save_json(SUPPLIERS_FILE, suppliers)

            return {
                "success": True,
                "supplier": updated
            }

    raise HTTPException(status_code=404, detail="Tedarikci bulunamadi")

@app.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: str, authorization: str = Header(None)):
    user = verify_user_token(authorization)
    suppliers = load_json(SUPPLIERS_FILE)
    next_suppliers = [
        supplier
        for supplier in suppliers
        if not (str(supplier.get("id")) == supplier_id and supplier.get("user_id") == user["id"])
    ]

    if len(next_suppliers) == len(suppliers):
        raise HTTPException(status_code=404, detail="Tedarikci bulunamadi")

    save_json(SUPPLIERS_FILE, next_suppliers)

    return {
        "success": True
    }

from fastapi.responses import Response

@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)
