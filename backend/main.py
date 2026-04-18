from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "Backend çalışıyor"}


@app.post("/upload-excel")
async def upload_excel(file: UploadFile = File(...)):
    df = pd.read_excel(file.file)
    data = df.to_dict(orient="records")

    return {
        "columns": list(df.columns),
        "data": data[:10]
    }


class MergeRequest(BaseModel):
    parsedSources: list


def normalize_text(value):
    return str(value or "").strip()


def normalize_quantity(value):
    raw = str(value or "").strip().replace(",", ".")
    if not raw:
        return 0

    import re
    match = re.search(r"-?\d+(?:\.\d+)?", raw)
    if not match:
        return 0

    try:
        return float(match.group())
    except Exception:
        return 0


@app.post("/merge-sources")
def merge_sources(payload: MergeRequest):
    parsed_sources = payload.parsedSources
    merged_map = {}

    for source in parsed_sources:
        source_type = source.get("sourceType", "")
        rows = source.get("rows", [])

        for row in rows:
            urun = ""
            miktar = 0
            birim = ""

            if source_type == "image-selected":
                urun = normalize_text(row.get("urun"))
                miktar = normalize_quantity(row.get("miktar"))
                birim = normalize_text(row.get("birim"))

            elif source_type == "pdf":
                urun = normalize_text(row.get("aciklama") or row.get("urun"))
                miktar = normalize_quantity(row.get("miktar"))
                birim = normalize_text(row.get("birim"))

            elif source_type == "excel":
                keys = list(row.keys())

                product_key = next(
                    (
                        k for k in keys
                        if "ürün" in k.lower()
                        or "urun" in k.lower()
                        or "açıklama" in k.lower()
                        or "aciklama" in k.lower()
                    ),
                    None
                )

                quantity_key = next(
                    (
                        k for k in keys
                        if "miktar" in k.lower()
                        or "adet" in k.lower()
                        or "qty" in k.lower()
                    ),
                    None
                )

                unit_key = next(
                    (
                        k for k in keys
                        if "birim" in k.lower()
                        or "unit" in k.lower()
                    ),
                    None
                )

                urun = normalize_text(row.get(product_key) if product_key else "")
                miktar = normalize_quantity(row.get(quantity_key) if quantity_key else "")
                birim = normalize_text(row.get(unit_key) if unit_key else "")

            if not urun:
                continue

            key = f"{urun.lower()}__{birim.lower()}"

            if key not in merged_map:
                merged_map[key] = {
                    "urun": urun,
                    "miktar": miktar,
                    "birim": birim,
                }
            else:
                merged_map[key]["miktar"] += miktar

    result = []
    for index, item in enumerate(merged_map.values(), start=1):
        result.append({
            "sira": index,
            "urun": item["urun"],
            "miktar": item["miktar"],
            "birim": item["birim"],
        })

    return {
        "rows": result,
        "message": "Tüm kaynaklar birleştirilerek icmalli liste oluşturuldu."
    }