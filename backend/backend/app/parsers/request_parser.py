import os
import re
import cv2
import numpy as np
import pandas as pd
import pdfplumber
import pytesseract

from app.utils import normalize_text, safe_float, safe_str


SUPPORTED_UNITS = {
    "adet", "ad", "pcs", "piece",
    "metre", "meter", "mt", "m",
    "kg", "gr", "g",
    "lt", "l", "litre",
    "kutu", "paket", "set", "takım", "takim",
    "rulo", "çift", "cift", "koli", "torba"
}


UNIT_MAP = {
    "ad": "adet",
    "pcs": "adet",
    "piece": "adet",
    "mt": "metre",
    "m": "metre",
    "meter": "metre",
    "l": "lt",
    "litre": "lt",
    "takim": "takım",
    "cift": "çift",
}


HEADER_WORDS = {
    "no", "sıra", "sira", "ürün", "urun", "malzeme",
    "açıklama", "aciklama", "miktar", "adet", "birim",
    "kod", "ürün kodu", "urun kodu"
}


def clean_line(value):
    text = str(value or "")
    text = text.replace("|", " ")
    text = text.replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def is_empty_value(value):
    n = normalize_text(value)
    return n in ["", "nan", "none", "null", "-", "_"]


def normalize_unit(value):
    text = clean_line(value)
    n = normalize_text(text)

    if is_empty_value(n):
        return "adet"

    if n in UNIT_MAP:
        return UNIT_MAP[n]

    if n in SUPPORTED_UNITS:
        return n

    return "adet"


def clean_quantity(value):
    if value is None:
        return 0.0

    text = str(value).strip()
    text = text.replace(",", ".")
    text = text.replace("O", "0").replace("o", "0")

    numbers = re.findall(r"\d+(?:\.\d+)?", text)

    if not numbers:
        return 0.0

    try:
        return float(numbers[-1])
    except Exception:
        return 0.0


def clean_product_text(value):
    text = clean_line(value)

    for word in HEADER_WORDS:
        text = re.sub(rf"\b{re.escape(word)}\b", " ", text, flags=re.IGNORECASE)

    text = re.sub(r"\s+", " ", text)
    return text.strip()


def looks_like_code(value):
    text = clean_line(value)

    if is_empty_value(text):
        return False

    return bool(re.fullmatch(r"[A-Za-z]{1,10}[-_/]?\d{1,12}", text))


def is_valid_product_text(text):
    text = clean_product_text(text)
    n = normalize_text(text)

    if is_empty_value(n):
        return False

    if n in HEADER_WORDS:
        return False

    letters = sum(ch.isalpha() for ch in text)

    if letters < 2:
        return False

    if len(text) < 3:
        return False

    return True


def make_row(code, description, quantity, unit, file_name, source_type):
    code = clean_line(code)
    description = clean_product_text(description)
    quantity = clean_quantity(quantity)
    unit = normalize_unit(unit)

    if is_empty_value(code):
        code = ""

    if not is_valid_product_text(description):
        return None

    if quantity <= 0:
        return None

    return {
        "urunKodu": code,
        "urunAciklamasi": description,
        "talepEdilenAdet": quantity,
        "birim": unit,
        "kaynakDosya": file_name,
        "kaynakTipi": source_type,
    }


def find_header_row(df):
    max_scan = min(len(df), 25)

    for i in range(max_scan):
        row_text = " ".join(normalize_text(x) for x in df.iloc[i].values)

        has_product = any(x in row_text for x in ["urun", "malzeme", "aciklama"])
        has_qty = any(x in row_text for x in ["miktar", "adet"])
        has_unit = "birim" in row_text

        if has_product and has_qty:
            return i

        if has_product and has_unit:
            return i

    return 0


def find_col(columns, aliases):
    for col in columns:
        col_norm = normalize_text(col)

        for alias in aliases:
            alias_norm = normalize_text(alias)

            if col_norm == alias_norm or alias_norm in col_norm:
                return col

    return None


def parse_request_excel(file_path, file_name):
    try:
        df_raw = pd.read_excel(file_path, header=None)
    except Exception:
        return []

    if df_raw.empty:
        return []

    header_row = find_header_row(df_raw)

    df = df_raw.copy()
    df.columns = df.iloc[header_row]
    df = df[header_row + 1:]
    df = df.dropna(how="all")

    code_col = find_col(df.columns, [
        "ürün kodu", "urun kodu", "malzeme kodu", "stok kodu", "kod"
    ])

    product_col = find_col(df.columns, [
        "ürün", "urun", "ürün adı", "urun adi", "malzeme", "kalem"
    ])

    desc_col = find_col(df.columns, [
        "açıklama", "aciklama", "ürün açıklaması", "urun aciklamasi"
    ])

    qty_col = find_col(df.columns, [
        "miktar", "adet", "talep edilen adet", "talep miktar", "ihtiyaç", "ihtiyac"
    ])

    unit_col = find_col(df.columns, [
        "birim", "unit"
    ])

    rows = []

    for _, r in df.iterrows():
        code = safe_str(r[code_col]) if code_col else ""

        product_text = safe_str(r[product_col]) if product_col else ""
        desc_text = safe_str(r[desc_col]) if desc_col else ""
        code = safe_str(r[code_col]) if code_col else ""

        if not code and looks_like_code(product_text):
            code = product_text
            description = desc_text
        else:
            description = desc_text or product_text
        try:
            quantity = float(str(r[qty_col]).replace(",", ".")) if qty_col else 0
        except:
            quantity = 0
        unit = safe_str(r[unit_col]).lower() if unit_col else "adet"
        if not unit:
            unit = "adet"
        if not description or quantity <= 0:
            continue
        row = make_row(code, description, quantity, unit, file_name, "excel")
        if row:
             rows.append(row)
    return dedupe_rows(rows)


def parse_request_line(line, file_name, source_type):
    line = clean_line(line)

    if not line:
        return None

    n = normalize_text(line)

    if any(x in n for x in ["ornek talep", "gorsel test", "firma", "tarih"]):
        return None
    
# Başlık satırlarını at: "Malzeme Listesi 1", "Talep Listesi 2" gibi

    if re.fullmatch(r".*(listesi|liste)\s*\d*$", n):
        return None
    
    if ("urun" in n and "miktar" in n) or ("aciklama" in n and "miktar" in n):
        return None

    tokens = line.split()

    if len(tokens) < 2:
        return None

    unit = "adet"

    last_token_norm = normalize_text(tokens[-1])

    if last_token_norm in SUPPORTED_UNITS or last_token_norm in UNIT_MAP:
        unit = tokens[-1]
        tokens = tokens[:-1]

    qty_index = None
    quantity = 0

    for i in range(len(tokens) - 1, -1, -1):
        candidate = clean_quantity(tokens[i])

        if candidate > 0:
            qty_index = i
            quantity = candidate
            break

    if qty_index is None:
        return None

    before_qty = tokens[:qty_index]

    if before_qty and before_qty[0].isdigit():
        before_qty = before_qty[1:]

    code = ""

    if before_qty and looks_like_code(before_qty[0]):
        code = before_qty[0]
        before_qty = before_qty[1:]

    description = " ".join(before_qty)

    return make_row(code, description, quantity, unit, file_name, source_type)


def parse_request_pdf(file_path, file_name):
    rows = []

    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables() or []

                for table in tables:
                    if not table:
                        continue

                    header = [normalize_text(x) for x in table[0]]
                    header_text = " ".join(header)

                    has_header = (
                        any("miktar" in x or "adet" in x for x in header)
                        and any("urun" in x or "malzeme" in x or "aciklama" in x for x in header)
                    )

                    data_rows = table[1:] if has_header else table

                    for table_row in data_rows:
                        cells = [clean_line(x) for x in table_row]
                        joined = " ".join(cells)

                        row = parse_request_line(joined, file_name, "pdf")

                        if row:
                            rows.append(row)

                text = page.extract_text() or ""

                for line in text.split("\n"):
                    row = parse_request_line(line, file_name, "pdf")

                    if row:
                        rows.append(row)

    except Exception:
        return []

    return dedupe_rows(rows)


def read_image_unicode(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def preprocess_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    gray = cv2.resize(
        gray,
        None,
        fx=2,
        fy=2,
        interpolation=cv2.INTER_CUBIC
    )

    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    return gray


def ocr_cell(cell_img, psm=6):
    if cell_img is None or cell_img.size == 0:
        return ""

    gray = cv2.cvtColor(cell_img, cv2.COLOR_BGR2GRAY)

    gray = cv2.resize(
        gray,
        None,
        fx=2,
        fy=2,
        interpolation=cv2.INTER_CUBIC
    )

    text = pytesseract.image_to_string(
        gray,
        lang="tur+eng",
        config=f"--oem 3 --psm {psm}"
    )

    return clean_line(text)


def detect_table_cells(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    thresh = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_MEAN_C,
        cv2.THRESH_BINARY_INV,
        15,
        10
    )

    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (45, 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 45))

    horizontal = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, vertical_kernel)

    table_mask = cv2.add(horizontal, vertical)

    contours, _ = cv2.findContours(
        table_mask,
        cv2.RETR_TREE,
        cv2.CHAIN_APPROX_SIMPLE
    )

    cells = []

    image_h, image_w = img.shape[:2]

    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)

        if w < 35 or h < 20:
            continue

        if w > image_w * 0.95 or h > image_h * 0.95:
            continue

        cells.append((x, y, w, h))

    cells = sorted(cells, key=lambda c: (c[1], c[0]))

    return cells


def group_cells_into_rows(cells):
    rows = []

    for cell in cells:
        x, y, w, h = cell
        placed = False

        for row in rows:
            avg_y = sum(c[1] for c in row) / len(row)

            if abs(y - avg_y) <= 18:
                row.append(cell)
                placed = True
                break

        if not placed:
            rows.append([cell])

    rows = [sorted(row, key=lambda c: c[0]) for row in rows]
    rows = sorted(rows, key=lambda row: sum(c[1] for c in row) / len(row))

    return rows


def crop_cell(img, cell):
    x, y, w, h = cell
    pad = 5

    return img[
        max(y + pad, 0): max(y + h - pad, y + 1),
        max(x + pad, 0): max(x + w - pad, x + 1)
    ]


def is_header_text(text):
    n = normalize_text(text)

    if not n:
        return False

    header_hits = 0

    for word in HEADER_WORDS:
        if normalize_text(word) in n:
            header_hits += 1

    return header_hits >= 2

def parse_table_image_by_cells(img, file_name):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    thresh = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_MEAN_C,
        cv2.THRESH_BINARY_INV,
        15,
        10
    )

    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (50, 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 50))

    horizontal = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, vertical_kernel)

    image_h, image_w = img.shape[:2]

    def cluster_positions(positions, tolerance=10):
        if not positions:
            return []

        positions = sorted(positions)
        groups = [[positions[0]]]

        for p in positions[1:]:
            if abs(p - groups[-1][-1]) <= tolerance:
                groups[-1].append(p)
            else:
                groups.append([p])

        return [int(sum(g) / len(g)) for g in groups]

    vertical_sum = np.sum(vertical > 0, axis=0)
    horizontal_sum = np.sum(horizontal > 0, axis=1)

    x_lines = [i for i, value in enumerate(vertical_sum) if value > image_h * 0.15]
    y_lines = [i for i, value in enumerate(horizontal_sum) if value > image_w * 0.25]

    x_lines = cluster_positions(x_lines, tolerance=12)
    y_lines = cluster_positions(y_lines, tolerance=12)

    if len(x_lines) < 5 or len(y_lines) < 3:
        return []

    def get_box(col_index, y1, y2):
        return (
            x_lines[col_index],
            y1,
            x_lines[col_index + 1] - x_lines[col_index],
            y2 - y1
        )

    # 1) Başlık satırını bul
    header_index = None
    header_cells = []

    for row_index in range(min(3, len(y_lines) - 1)):
        y1 = y_lines[row_index]
        y2 = y_lines[row_index + 1]

        cells_text = []

        for col_index in range(len(x_lines) - 1):
            box = get_box(col_index, y1, y2)
            text = clean_line(ocr_cell(crop_cell(img, box), psm=6))
            cells_text.append(text)

        header_text = normalize_text(" ".join(cells_text))

        if (
            ("urun" in header_text or "ürün" in header_text or "malzeme" in header_text)
            and ("miktar" in header_text or "adet" in header_text)
            and "birim" in header_text
        ):
            header_index = row_index
            header_cells = cells_text
            break

    if header_index is None:
        return []

    # 2) Başlığa göre kolon indekslerini bul
    product_col = None
    desc_col = None
    qty_col = None
    unit_col = None
    code_col = None

    for i, text in enumerate(header_cells):
        n = normalize_text(text)

        if "kod" in n:
            code_col = i
        elif "urun" in n or "ürün" in n or "malzeme" in n:
            product_col = i
        elif "aciklama" in n or "açıklama" in n:
            desc_col = i
        elif "miktar" in n or "adet" in n:
            qty_col = i
        elif "birim" in n:
            unit_col = i

    if qty_col is None or unit_col is None:
        return []

    if product_col is None and desc_col is None:
        return []

    parsed_rows = []

    # 3) Başlıktan sonraki satırları oku
    for row_index in range(header_index + 1, len(y_lines) - 1):
        y1 = y_lines[row_index]
        y2 = y_lines[row_index + 1]

        if y2 - y1 < 15:
            continue

        def read_col(col_index, psm=6):
            if col_index is None:
                return ""
            if col_index < 0 or col_index >= len(x_lines) - 1:
                return ""

            box = get_box(col_index, y1, y2)
            return clean_line(ocr_cell(crop_cell(img, box), psm=psm))

        product_text = read_col(product_col, psm=6)
        desc_text = read_col(desc_col, psm=6)
        qty_text = read_col(qty_col, psm=7)
        unit_text = read_col(unit_col, psm=7)
        code_text = read_col(code_col, psm=7)

        print("DEBUG GORSEL SATIR:", {
                "product_col": product_col,
                "desc_col": desc_col,
                "qty_col": qty_col,
                "unit_col": unit_col,
                "product_text": product_text,
                "desc_text": desc_text,
                "qty_text": qty_text,
                "unit_text": unit_text,
                "code_text": code_text,
        })

        # Ürün kolonunda AA001 gibi kod varsa onu kod yap
        if not code_text and looks_like_code(product_text):
            code_text = product_text
            final_description = desc_text
        else:
            final_description = desc_text or product_text

        final_description = clean_product_text(final_description)
        quantity_value = clean_quantity(qty_text)
        unit_text = clean_line(unit_text)

        if not is_valid_product_text(final_description):
            continue

        if quantity_value <= 0:
            continue

        row = make_row(
            code_text,
            final_description,
            quantity_value,
            unit_text or "adet",
            file_name,
            "image"
        )

        if row:
            parsed_rows.append(row)

    return dedupe_rows(parsed_rows)

def ocr_words(img):
    data = pytesseract.image_to_data(
        img,
        lang="tur+eng",
        config="--oem 3 --psm 6",
        output_type=pytesseract.Output.DICT
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

        if conf < 25:
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

            if abs(word["cy"] - avg_y) <= max(14, word["h"] * 0.9):
                row.append(word)
                placed = True
                break

        if not placed:
            rows.append([word])

    return [sorted(row, key=lambda w: w["x"]) for row in rows]


def detect_columns_from_header(word_rows):
    header_row = None

    for row in word_rows:
        text = " ".join(w["text"] for w in row)
        n = normalize_text(text)

        has_product = any(x in n for x in ["urun", "malzeme", "aciklama"])
        has_qty = any(x in n for x in ["miktar", "adet"])
        has_unit = "birim" in n

        if has_product and has_qty:
            header_row = row
            break

        if has_product and has_unit:
            header_row = row
            break

    if not header_row:
        return None

    columns = {}

    for word in header_row:
        n = normalize_text(word["text"])

        if n in ["no", "sira", "sıra"]:
            columns["no"] = word["cx"]
        elif "kod" in n:
            columns["code"] = word["cx"]
        elif "urun" in n or "malzeme" in n:
            columns["product"] = word["cx"]
        elif "aciklama" in n:
            columns["description"] = word["cx"]
        elif "miktar" in n or "adet" in n:
            columns["quantity"] = word["cx"]
        elif "birim" in n:
            columns["unit"] = word["cx"]

    if "quantity" not in columns:
        return None

    if "product" not in columns and "description" not in columns:
        return None

    return columns


def row_from_word_columns(word_row, columns, file_name):
    parts = {
        "no": [],
        "code": [],
        "product": [],
        "description": [],
        "quantity": [],
        "unit": [],
    }

    sorted_columns = sorted(columns.items(), key=lambda x: x[1])

    for word in word_row:
        nearest_col = min(
            sorted_columns,
            key=lambda col: abs(word["cx"] - col[1])
        )[0]

        parts[nearest_col].append(word["text"])

    code_text = clean_line(" ".join(parts["code"]))
    product_text = clean_line(" ".join(parts["product"]))
    desc_text = clean_line(" ".join(parts["description"]))
    quantity_text = clean_line(" ".join(parts["quantity"]))
    unit_text = clean_line(" ".join(parts["unit"]))

    code_text = code_text or ""

    if not code_text and looks_like_code(product_text):
        code_text = product_text
        final_description = desc_text
    else:
        final_description = desc_text or product_text

    if not is_valid_product_text(final_description):
        return None
    
    quantity = clean_quantity(quantity_text)

    if quantity <= 0:
        return None

    return make_row(
        code_text,
        final_description,
        quantity,
        unit_text or "adet",
        file_name,
        "image"
    )


def parse_image_by_words(img, file_name):
    processed = preprocess_image(img)
    word_rows = group_words_by_rows(ocr_words(processed))

    columns = detect_columns_from_header(word_rows)

    rows = []

    if columns:
        for word_row in word_rows:
            text = " ".join(w["text"] for w in word_row)

            if is_header_text(text):
                continue

            row = row_from_word_columns(word_row, columns, file_name)

            if row:
                rows.append(row)

        return dedupe_rows(rows)

    text = pytesseract.image_to_string(
        processed,
        lang="tur+eng",
        config="--oem 3 --psm 6"
    )

    for line in text.split("\n"):
        row = parse_request_line(line, file_name, "image")

        if row:
            rows.append(row)

    return dedupe_rows(rows)

def parse_request_image(file_path, file_name):
    img = read_image_unicode(file_path)

    if img is None:
        return []

    table_rows = parse_table_image_by_cells(img, file_name)

    if table_rows:
        return dedupe_rows(table_rows)

    return parse_image_by_words(img, file_name)

def product_match_key(row):
    text = normalize_text(row.get("urunAciklamasi", ""))

    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    unit = normalize_text(row.get("birim", "adet"))

    return f"{text}__{unit}"


def merge_request_rows(rows):
    merged = {}
    auto_code_counter = 1

    for row in rows:
        code = clean_line(row.get("urunKodu", ""))
        description = clean_product_text(row.get("urunAciklamasi", ""))
        quantity = clean_quantity(row.get("talepEdilenAdet", 0))
        unit = normalize_unit(row.get("birim", "adet"))

        if not is_valid_product_text(description):
            continue

        if quantity <= 0:
            continue

        key = product_match_key({
            "urunAciklamasi": description,
            "birim": unit,
        })

        if key not in merged:
            merged[key] = {
                "urunKodu": code,
                "urunAciklamasi": description,
                "talepEdilenAdet": quantity,
                "birim": unit,
            }
        else:
            merged[key]["talepEdilenAdet"] += quantity

            if not merged[key]["urunKodu"] and code:
                merged[key]["urunKodu"] = code

    result = []

    for item in merged.values():
        if not item["urunKodu"]:
            item["urunKodu"] = f"PRD-{auto_code_counter:04d}"
            auto_code_counter += 1

        result.append(item)

    return result


def dedupe_rows(rows):
    seen = set()
    result = []

    for row in rows:
        if not row:
            continue

        key = (
            normalize_text(row.get("urunKodu", "")),
            normalize_text(row.get("urunAciklamasi", "")),
            clean_quantity(row.get("talepEdilenAdet", 0)),
            normalize_text(row.get("birim", "")),
            row.get("kaynakDosya", ""),
        )

        if key in seen:
            continue

        seen.add(key)
        result.append(row)

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