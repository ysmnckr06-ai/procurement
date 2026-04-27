import os
import re
import pandas as pd
import pdfplumber
import pytesseract
import cv2
import numpy as np

from app.utils import normalize_text, safe_float, safe_str


UNITS = {"adet", "ad", "metre", "mt", "m", "kutu", "paket", "kg", "lt", "mm", "cm", "takim", "takım", "set", "rulo"}


def clean_line(value):
    return re.sub(r"\s+", " ", str(value or "").replace("|", " ")).strip()


def normalize_unit(value):
    n = normalize_text(value)
    if n in ["ad", "adet"]:
        return "adet"
    if n in ["mt", "m", "metre"]:
        return "metre"
    if n in ["takim", "takım"]:
        return "takım"
    if n in UNITS:
        return n
    return "adet"


def looks_like_code(value):
    return bool(re.fullmatch(r"[A-Za-z]{1,8}[-_]?\d{1,8}", str(value or "").strip()))


def is_bad_text(text):
    n = normalize_text(text)
    if n in ["", "nan", "none", "null", "-", "_"]:
        return True
    letters = sum(ch.isalpha() for ch in str(text))
    if letters < 2:
        return True
    return False

def extract_last_number(value):
    found_numbers = re.findall(r"\d+(?:[,.]\d+)?", str(value or ""))
    if found_numbers:
        return found_numbers[-1]
    return "0"

def make_row(code, desc, qty, unit, file_name, source_type):
    code = clean_line(code)
    desc = clean_line(desc)
    qty = safe_float(qty)
    unit = normalize_unit(unit)

    if normalize_text(code) in ["nan", "none", "null"]:
        code = ""

    if is_bad_text(desc) or qty <= 0:
        return None

    return {
        "urunKodu": code,
        "urunAciklamasi": desc,
        "talepEdilenAdet": qty,
        "birim": unit,
        "kaynakDosya": file_name,
        "kaynakTipi": source_type,
    }


def find_header_row(df):
    for i in range(min(len(df), 20)):
        row_text = " ".join(normalize_text(x) for x in df.iloc[i].values)
        if ("miktar" in row_text or "adet" in row_text) and ("urun" in row_text or "aciklama" in row_text):
            return i
    return 0


def find_col(columns, aliases):
    for col in columns:
        n = normalize_text(col)
        for alias in aliases:
            a = normalize_text(alias)
            if n == a or a in n:
                return col
    return None


def parse_request_excel(file_path, file_name):
    df = pd.read_excel(file_path, header=None)
    header_row = find_header_row(df)

    df.columns = df.iloc[header_row]
    df = df[header_row + 1:].dropna(how="all")

    code_col = find_col(df.columns, ["ürün kodu", "urun kodu", "kod"])
    product_col = find_col(df.columns, ["ürün", "urun", "malzeme"])
    desc_col = find_col(df.columns, ["açıklama", "aciklama", "ürün açıklaması", "urun aciklamasi"])
    qty_col = find_col(df.columns, ["miktar", "adet", "talep edilen adet"])
    unit_col = find_col(df.columns, ["birim", "unit"])

    rows = []

    for _, r in df.iterrows():
        code = safe_str(r[code_col]) if code_col else ""

        product_text = safe_str(r[product_col]) if product_col else ""
        desc_text = safe_str(r[desc_col]) if desc_col else ""

        desc = desc_text or product_text
        qty = safe_float(r[qty_col]) if qty_col else 0
        unit = safe_str(r[unit_col]) if unit_col else "adet"

        row = make_row(code, desc, qty, unit, file_name, "excel")
        if row:
            rows.append(row)

    return rows


def parse_request_line(line, file_name, source_type):
    line = clean_line(line)
    low = normalize_text(line)

    if not line:
        return None

    if any(x in low for x in ["ornek talep", "gorsel test", "firma", "tarih"]):
        return None

    if ("urun" in low and "miktar" in low) or ("aciklama" in low and "miktar" in low):
        return None

    tokens = line.split()
    if len(tokens) < 2:
        return None

    unit = "adet"
    if normalize_text(tokens[-1]) in UNITS:
        unit = tokens[-1]
        tokens = tokens[:-1]

    qty_index = None
    qty = 0

    for i in range(len(tokens) - 1, -1, -1):
        val = safe_float(tokens[i])
        if val > 0:
            qty_index = i
            qty = val
            break

    if qty_index is None:
        return None

    before = tokens[:qty_index]

    if before and before[0].isdigit():
        before = before[1:]

    code = ""
    if before and looks_like_code(before[0]):
        code = before[0]
        before = before[1:]

    desc = " ".join(before)

    return make_row(code, desc, qty, unit, file_name, source_type)


def parse_request_pdf(file_path, file_name):
    rows = []

    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables() or []

            for table in tables:
                if not table:
                    continue

                header = [normalize_text(x) for x in table[0]]
                has_header = any("miktar" in x for x in header) and (any("urun" in x for x in header) or any("aciklama" in x for x in header))

                data_rows = table[1:] if has_header else table

                for tr in data_rows:
                    cells = [clean_line(x) for x in tr]

                    joined = " ".join(cells)
                    row = parse_request_line(joined, file_name, "pdf")
                    if row:
                        rows.append(row)

            text = page.extract_text() or ""
            raw_lines = [clean_line(x) for x in text.split("\n") if clean_line(x)]

            i = 0
            while i < len(raw_lines):
                line = raw_lines[i]
                if i + 1 < len(raw_lines) and re.fullmatch(r"\d+(?:[,.]\d+)?", raw_lines[i + 1]):
                    line = f"{line} {raw_lines[i + 1]}"
                    i += 1

                row = parse_request_line(line, file_name, "pdf")
                if row:
                    rows.append(row)
                i += 1

    return dedupe_rows(rows)


def read_image_unicode(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def preprocess_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return gray


def ocr_words(img):
    data = pytesseract.image_to_data(
        img,
        lang="tur+eng",
        config="--oem 3 --psm 6",
        output_type=pytesseract.Output.DICT,
    )

    words = []
    for i, text in enumerate(data["text"]):
        text = clean_line(text)
        if not text:
            continue

        try:
            conf = float(data["conf"][i])
        except Exception:
            conf = -1

        if conf < 20:
            continue

        words.append({
            "text": text,
            "x": data["left"][i],
            "y": data["top"][i],
            "w": data["width"][i],
            "h": data["height"][i],
            "cx": data["left"][i] + data["width"][i] / 2,
            "cy": data["top"][i] + data["height"][i] / 2,
        })

    return words


def group_words_by_rows(words):
    if not words:
        return []

    words = sorted(words, key=lambda w: (w["cy"], w["x"]))
    rows = []

    for word in words:
        placed = False
        for row in rows:
            avg_y = sum(w["cy"] for w in row) / len(row)
            if abs(word["cy"] - avg_y) <= max(12, word["h"] * 0.8):
                row.append(word)
                placed = True
                break
        if not placed:
            rows.append([word])

    return [sorted(r, key=lambda w: w["x"]) for r in rows]


def detect_image_columns(rows):
    header_row = None

    for row in rows:
        text = " ".join(w["text"] for w in row)
        n = normalize_text(text)
        if ("urun" in n or "aciklama" in n) and "miktar" in n:
            header_row = row
            break

    if not header_row:
        return None

    positions = {}
    for w in header_row:
        n = normalize_text(w["text"])
        if "no" == n:
            positions["no"] = w["cx"]
        elif "urun" in n:
            positions["urun"] = w["cx"]
        elif "aciklama" in n:
            positions["aciklama"] = w["cx"]
        elif "miktar" in n:
            positions["miktar"] = w["cx"]
        elif "birim" in n:
            positions["birim"] = w["cx"]

    if "miktar" not in positions:
        return None

    return positions


def row_to_request_from_columns(row, cols, file_name):
    parts = {
        "no": [],
        "urun": [],
        "aciklama": [],
        "miktar": [],
        "birim": [],
    }

    sorted_cols = sorted(cols.items(), key=lambda x: x[1])

    for w in row:
        nearest = min(sorted_cols, key=lambda c: abs(w["cx"] - c[1]))[0]
        parts[nearest].append(w["text"])

    product_text = clean_line(" ".join(parts["urun"]))
    desc_text = clean_line(" ".join(parts["aciklama"]))
    qty_text = clean_line(" ".join(parts["miktar"]))
    unit_text = clean_line(" ".join(parts["birim"]))

    desc = product_text or desc_text

    # Açıklama kolonu ürün açıklaması değil, detay ise ürün kolonunu esas alıyoruz.
    qty = safe_float(qty_text)
    if qty <= 0:
        return None

    return make_row("", desc, qty, unit_text or "adet", file_name, "image")

def ocr_cell(cell_img):
    gray = cv2.cvtColor(cell_img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)

    text = pytesseract.image_to_string(
        gray,
        lang="tur+eng",
        config="--oem 3 --psm 6"
    )

    return clean_line(text)


def parse_table_image_by_cells(img, file_name):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    thresh = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_MEAN_C,
        cv2.THRESH_BINARY_INV,
        15, 10
    )

    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))

    horizontal = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, vertical_kernel)

    table_mask = cv2.add(horizontal, vertical)

    contours, _ = cv2.findContours(
        table_mask,
        cv2.RETR_TREE,
        cv2.CHAIN_APPROX_SIMPLE
    )

    cells = []

    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)

        if w < 40 or h < 20:
            continue

        if w > img.shape[1] * 0.95 or h > img.shape[0] * 0.95:
            continue

        cells.append((x, y, w, h))

    if not cells:
        return []

    cells = sorted(cells, key=lambda c: (c[1], c[0]))
    rows = []

    for cell in cells:
        x, y, w, h = cell
        placed = False

        for row in rows:
            avg_y = sum(c[1] for c in row) / len(row)

            if abs(y - avg_y) < 20:
                row.append(cell)
                placed = True
                break

        if not placed:
            rows.append([cell])

    rows = [sorted(r, key=lambda c: c[0]) for r in rows]
    rows = [r for r in rows if len(r) >= 4]

    parsed_rows = []

    def crop(cell):
        x, y, w, h = cell
        pad = 4
        return img[
            max(y + pad, 0): y + h - pad,
            max(x + pad, 0): x + w - pad
        ]

    for row_cells in rows:
        if len(row_cells) >= 5:
            product_cell = row_cells[1]
            qty_cell = row_cells[-2]
            unit_cell = row_cells[-1]
        else:
            product_cell = row_cells[0]
            qty_cell = row_cells[-2]
            unit_cell = row_cells[-1]

        product_text = ocr_cell(crop(product_cell))
        qty_text = ocr_cell(crop(qty_cell))
        unit_text = ocr_cell(crop(unit_cell))

# Header kelimeleri ürün satırına karışırsa sadece kelimeyi temizle, satırı silme
        
        product_text = product_text.replace("Ürün", "").replace("Urun", "").strip()
        qty_text = qty_text.replace("Miktar", "").strip()
        unit_text = unit_text.replace("Birim", "").strip()

        qty_text = extract_last_number(qty_text)

        if not product_text or len(product_text) < 3:
            continue

        row = make_row(
            "",
            product_text,
            qty_text,
            unit_text,
            file_name,
            "image"
        )

        if row:
            parsed_rows.append(row)

    return dedupe_rows(parsed_rows)

def parse_request_image(file_path, file_name):
    img = read_image_unicode(file_path)

    if img is None:
        return []

    # 1. Önce çizgili tablo olarak okumayı dene
    table_rows = parse_table_image_by_cells(img, file_name)

    if table_rows and len(table_rows) >= 3:
        return table_rows

    # 2. Tablo yakalanamazsa eski düz OCR fallback
    processed = preprocess_image(img)

    text = pytesseract.image_to_string(
        processed,
        lang="tur+eng",
        config="--oem 3 --psm 6"
    )

    rows = []

    for line in text.split("\n"):
        row = parse_request_line(line, file_name, "image")
        if row:
            rows.append(row)

    return dedupe_rows(rows)


def dedupe_rows(rows):
    seen = set()
    result = []

    for r in rows:
        key = (
            normalize_text(r.get("urunKodu", "")),
            normalize_text(r.get("urunAciklamasi", "")),
            float(r.get("talepEdilenAdet", 0) or 0),
            normalize_text(r.get("birim", "")),
            r.get("kaynakDosya", ""),
        )

        if key in seen:
            continue

        seen.add(key)
        result.append(r)

    return result


def parse_request_file(file_path, file_name):
    ext = os.path.splitext(file_name.lower())[1]

    if ext in [".xlsx", ".xls"]:
        return parse_request_excel(file_path, file_name)

    if ext == ".pdf":
        return parse_request_pdf(file_path, file_name)

    if ext in [".png", ".jpg", ".jpeg", ".webp"]:
        return parse_request_image(file_path, file_name)

    return []