from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any
import pandas as pd
import io
import pdfplumber

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "Backend çalışıyor"}

@app.post("/parse-excel")
async def parse_excel(file: UploadFile = File(...)):
    contents = await file.read()
    df = pd.read_excel(io.BytesIO(contents))

    df.columns = [str(col).lower() for col in df.columns]

    urun = None
    miktar = None
    birim = None

    for col in df.columns:
        if "ürün" in col or "urun" in col or "aciklama" in col:
            urun = col
        if "miktar" in col or "adet" in col:
            miktar = col
        if "birim" in col:
            birim = col

    if not urun or not miktar:
        return {"error": "Gerekli kolonlar bulunamadı"}

    result = []
    for _, row in df.iterrows():
        result.append({
            "urun": str(row[urun]),
            "miktar": float(row[miktar]) if str(row[miktar]).strip() else 0,
            "birim": str(row[birim]) if birim else ""
        })

    return {"data": result}

@app.post("/parse-pdf")
async def parse_pdf(file: UploadFile = File(...)):
    contents = await file.read()
    rows = []

    units = [
        "adet", "ad", "kg", "lt", "l", "metre", "mt",
        "paket", "kutu", "torba", "takım", "takim", "plaka", "tüp", "tup"
    ]

    with pdfplumber.open(io.BytesIO(contents)) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text()
            if not text:
                continue

            lines = text.split("\n")
            for line_index, line in enumerate(lines, start=1):
                cleaned = str(line).strip()
                if not cleaned:
                    continue

                lower = cleaned.lower()

                if (
                    "s.no" in lower
                    or "sıra no" in lower
                    or "aciklama" in lower
                    or "açıklama" in lower
                    or "birim" in lower
                    or "miktar" in lower
                ):
                    continue

                parts = cleaned.split()
                if len(parts) < 3:
                    continue

                # ilk sayı satır no ise at
                if parts[0].isdigit():
                    parts = parts[1:]

                # ürün kodu sayıysa at
                if parts and parts[0].isdigit():
                    parts = parts[1:]

                miktar = ""
                birim = ""
                urun_parts = parts[:]

                # sondan miktar al
                if urun_parts:
                    last = urun_parts[-1].replace(",", ".")
                    try:
                        float(last)
                        miktar = urun_parts.pop(-1)
                    except:
                        pass

                # sondan birim al
                if urun_parts:
                    last_lower = urun_parts[-1].lower()
                    if last_lower in units:
                        birim = urun_parts.pop(-1)

                urun = " ".join(urun_parts).strip()

                if not urun:
                    continue

                rows.append({
                    "sayfa": page_index,
                    "satirNo": line_index,
                    "urun": urun,
                    "birim": birim,
                    "miktar": miktar,
                    "hamMetin": cleaned
                })

    return {
        "id": f"{file.filename}-pdf-0",
        "fileName": file.filename,
        "sourceType": "pdf",
        "label": f"PDF - {file.filename}",
        "rows": rows,
        "columns": ["sayfa", "satirNo", "urun", "birim", "miktar", "hamMetin"]
    }
from pydantic import BaseModel
from typing import List, Any

class MergeRow(BaseModel):
    urunKodu: str | None = ""
    urunAciklamasi: str
    miktar: float | int | str
    birim: str

class MergeRowsRequest(BaseModel):
    rows: List[MergeRow]

def normalize_text(value: Any) -> str:
    return str(value or "").strip()

def normalize_quantity(value: Any) -> float:
    text = str(value or "").strip().replace(",", ".")
    filtered = ""

    for ch in text:
        if ch.isdigit() or ch in [".", "-"]:
            filtered += ch

    try:
        return float(filtered) if filtered else 0
    except:
        return 0

@app.post("/merge-sources")
def merge_sources(payload: MergeRowsRequest):
    merged = {}
    auto_code_map = {}
    auto_code_counter = 1
    match_candidates = []

    def generate_auto_code():
        nonlocal auto_code_counter
        code = f"PRD-{auto_code_counter:04}"
        auto_code_counter += 1
        return code

    def desc_key_of(aciklama: str, birim: str) -> str:
        return f"{aciklama.lower()}__{birim.lower()}"

    # 1. GEÇİŞ: kodlu ürünleri topla
    description_to_existing = {}
    for row in payload.rows:
        urun_kodu = normalize_text(row.urunKodu)
        urun_aciklamasi = normalize_text(row.urunAciklamasi)
        birim = normalize_text(row.birim)

        if urun_kodu and urun_aciklamasi:
            description_to_existing[desc_key_of(urun_aciklamasi, birim)] = {
                "urunKodu": urun_kodu,
                "urunAciklamasi": urun_aciklamasi,
            }

    # 2. GEÇİŞ: tüm satırları işle
    for row in payload.rows:
        urun_kodu = normalize_text(row.urunKodu)
        urun_aciklamasi = normalize_text(row.urunAciklamasi)
        birim = normalize_text(row.birim)
        miktar = normalize_quantity(row.miktar)

        if not urun_aciklamasi:
            continue

        desc_key = desc_key_of(urun_aciklamasi, birim)

        # Kod yoksa önce mevcut kodlu ürün var mı bak
        if not urun_kodu:
            if desc_key in description_to_existing:
                suggested = description_to_existing[desc_key]

                urun_kodu = generate_auto_code()

                match_candidates.append({
                    "id": f"{urun_kodu}__{desc_key}",
                    "newCode": urun_kodu,
                    "newDescription": urun_aciklamasi,
                    "suggestedCode": suggested["urunKodu"],
                    "suggestedDescription": suggested["urunAciklamasi"],
                })
            else:
                if desc_key not in auto_code_map:
                    auto_code_map[desc_key] = generate_auto_code()
                urun_kodu = auto_code_map[desc_key]

        key = f"{urun_kodu.lower()}__{birim.lower()}"

        if key not in merged:
            merged[key] = {
                "urunKodu": urun_kodu,
                "urunAciklamasi": urun_aciklamasi,
                "miktar": miktar,
                "birim": birim,
            }
        else:
            merged[key]["miktar"] += miktar

    result = []
    for i, item in enumerate(merged.values(), start=1):
        result.append({
            "sira": i,
            "urunKodu": item["urunKodu"],
            "urunAciklamasi": item["urunAciklamasi"],
            "miktar": item["miktar"],
            "birim": item["birim"],
        })

    auto_assigned_count = sum(
        1 for item in result if item["urunKodu"].startswith("PRD-")
    )

    return {
        "message": "Kaynaklar birleştirildi.",
        "rows": result,
        "matchCandidates": match_candidates,
        "autoAssignedCount": auto_assigned_count,
    }