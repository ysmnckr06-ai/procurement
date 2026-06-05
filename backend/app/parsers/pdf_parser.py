import pdfplumber
import re
import os


SECTION_NAMES = {
    "trafo",
    "kompanzasyon",
    "adp",
    "uadp",
    "sgn-t",
    "bk-t1",
    "bk-t2",
    "cms-kt-2",
    "cms-kt1",
    "mtf-t",
    "mtf-kt",
    "kzn-kt",
    "zk-t1",
    "zk-t2",
    "1k-t1",
    "1k-t2",
    "atl-at1",
    "atl-at2",
    "atl-at3",
    "atl-at4",
    "atl-at5",
    "2k-t1",
}


def clean_text(val):
    if val is None:
        return ""
    text = str(val).strip()
    if text.lower() in ["nan", "none", "null"]:
        return ""
    return re.sub(r"\s+", " ", text)

def normalize_tr(val):
    text = str(val or "").lower()
    replacements = {
        "ı": "i",
        "i̇": "i",
        "ğ": "g",
        "ü": "u",
        "ş": "s",
        "ö": "o",
        "ç": "c",
        "Ä±": "i",
        "Ä°": "i",
        "ÄŸ": "g",
        "Ã¼": "u",
        "ÅŸ": "s",
        "Ã¶": "o",
        "Ã§": "c",
        "̇": "",
    }

    for source, target in replacements.items():
        text = text.replace(source.lower(), target)

    return clean_text(text)

def clean_number(val):
    if val is None:
        return 0.0

    s = str(val).strip()
    s = s.replace("₺", "").replace("€", "").replace("£", "")
    s = s.replace("₺", "").replace("TL", "").replace("TRY", "")
    s = s.replace("$", "").replace("USD", "")
    s = s.replace("€", "").replace("EUR", "")
    s = s.replace("%", "")
    s = s.replace(",", ".")

    if s.count(".") > 1:
        parts = s.split(".")
        s = "".join(parts[:-1]) + "." + parts[-1]

    s = re.sub(r"[^0-9.\-]", "", s)

    try:
        return float(s)
    except Exception:
        return 0.0


def detect_currency(text):
    text = str(text or "").upper()

    if "€" in text:
        return "EUR"
    if "£" in text or "GBP" in text:
        return "GBP"
    if "$" in text or "USD" in text:
        return "USD"
    if "€" in text or "EUR" in text:
        return "EUR"
    return "TRY"


def money_equals(left, right, tolerance=0.05):
    return abs(float(left or 0) - float(right or 0)) <= tolerance


def canonical_section_name(value):
    text = normalize_tr(value)
    compact = re.sub(r"[-_\s]+", "", text)

    for section_name in SECTION_NAMES:
        if compact == re.sub(r"[-_\s]+", "", section_name):
            return section_name.upper()

    return ""


def is_meaningful_section_label(value):
    text = clean_text(value)

    if not text:
        return False

    low = normalize_tr(text)
    normalized = re.sub(r"[^a-z0-9]", "", low)

    if not normalized or normalized in ["tl", "try", "eur", "usd"]:
        return False

    if clean_number(text) > 0:
        return False

    return True


def section_name_from_cells(cells):
    text_cells = []

    for cell in cells:
        text = clean_text(cell)

        if not is_meaningful_section_label(text):
            continue

        low = normalize_tr(text)
        if low in ["-", "_"] or should_skip_line(low):
            continue

        text_cells.append(text)

    if not text_cells:
        return ""

    return clean_text(text_cells[-1]).upper()


def looks_like_section_total_row(cells, code, brand, description, quantity, line_total):
    if line_total <= 0:
        return False

    joined = " ".join(clean_text(cell) for cell in cells)

    if should_skip_line(joined) or is_product_table_header(joined):
        return False

    has_product_identity = bool(code and brand and description)

    if has_product_identity and quantity > 0:
        return False

    # PDF exports do not expose Excel fill colors. A row with a price/total but
    # missing the required material identity is a group total, whatever its name is.
    return bool(section_name_from_cells(cells))


def is_section_name(value):
    return bool(canonical_section_name(value))


def row_numbers(cells):
    numbers = []

    for cell in cells:
        value = clean_number(cell)

        if value > 0:
            numbers.append(value)

    return numbers


def choose_kdv_excluded_total(numbers):
    positive = sorted({round(float(number), 2) for number in numbers if float(number or 0) > 0})

    if not positive:
        return 0

    if len(positive) >= 2:
        for lower in positive:
            for higher in positive:
                if higher <= lower:
                    continue

                if money_equals(higher, lower * 1.20, max(0.50, lower * 0.01)):
                    return lower

    return positive[-1]


def choose_section_total(line_total, numbers):
    net_total = choose_kdv_excluded_total(numbers)

    if line_total > 0 and net_total > 0 and money_equals(line_total, net_total * 1.20, max(0.50, net_total * 0.01)):
        return net_total

    return line_total or net_total


def is_product_table_header(line):
    low = normalize_tr(line)

    return (
        ("no" in low or "sira" in low)
        and "malzeme" in low
        and "kod" in low
        and "aciklama" in low
        and "adet" in low
        and ("tutar" in low or "net fiyat" in low or "fiyat" in low)
    )


def detect_company_name(full_text, fallback_firma, file_name):
    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]

    for line in lines[:10]:
        low = line.lower()

        if "firma" in low or "tedarikçi" in low or "tedarikci" in low or "satıcı" in low or "satici" in low:
            parts = re.split(r":|-", line, maxsplit=1)
            if len(parts) > 1 and clean_text(parts[1]):
                return clean_text(parts[1])

        if (
            len(line) >= 3
            and "teklif" not in low
            and "ürün" not in low
            and "urun" not in low
            and "fiyat" not in low
            and "miktar" not in low
        ):
            return line

    if fallback_firma:
        return fallback_firma

    return os.path.splitext(file_name)[0].replace("_", " ").replace("-", " ").title()


def detect_footer_info(full_text):
    vade = ""
    termin = ""
    dip_toplam = 0
    kdv = 0
    genel_toplam = 0

    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]

    for line in lines:
        low = line.lower()

        if "vade" in low or "ödeme" in low or "odeme" in low:
            vade = line

        if "termin" in low or "teslim" in low:
            termin = line

        nums = re.findall(r"\d+(?:[.,]\d+)?", line)
        nums = [clean_number(x) for x in nums]

        if "ara toplam" in low or "dip toplam" in low:
            if nums:
                dip_toplam = nums[-1]

        if "kdv" in low:
            if nums:
                kdv = nums[-1]

        if "genel toplam" in low or "yekun" in low or "yekün" in low:
            if nums:
                genel_toplam = nums[-1]

    return {
        "vade": vade,
        "termin": termin,
        "dipToplam": dip_toplam,
        "kdv": kdv,
        "genelToplam": genel_toplam,
    }


def should_skip_line(line):
    low = normalize_tr(line)

    if re.search(r"\b[tf]\s*:\s*\+?\s*\d", low):
        return True

    skip_words = [
        "not",
        "fiyatlandırma",
        "teklif tüm",
        "teklif tum",
        "firma",
        "tarih",
        "teklif no",
        "ürün kodu",
        "urun kodu",
        "ürün açıklaması",
        "urun aciklamasi",
        "birim fiyat",
        "net fiyat",
        "net toplam",
        "ara toplam",
        "dip toplam",
        "genel toplam",
        "kdv",
        "vade",
        "ödeme",
        "odeme",
        "opsiyon",
        "teklif",
        "toplam",
        "proje adi",
        "proje adı",
        "telefon",
        "tel:",
        "t:+",
        "faks",
        "fax",
        "f:+",
        "mail",
        "e-mail",
        "email",
        "www",
        "hasemek",
        "mpsystem",
        "musteri onayi",
        "musteri onay",
        "teyit ediniz",
        "siparisin onayi",
        "siparis onayi",
        "teknik cizim",
        "uretime baslanacak",
        "teslimat suresi",
        "uretim hatalari",
        "saha revizyonlari",
        "servis ucreti",
        "konaklama",
        "ulasim ucreti",
    ]

    return any(word in low for word in skip_words)


def parse_pdf_line(line):
    line = clean_text(line)

    if not line or should_skip_line(line):
        return None
    
    low = normalize_tr(line)

    if is_section_name(line) or is_section_name(line.split()[0] if line.split() else ""):
        return None

    
    if re.match(r"^(dip toplam|genel toplam|kdv)", low):
        return None 
    
    currency = detect_currency(line)

    table_row = re.match(
        r"^\s*\d+\s+"
        r"(?P<code>[A-Za-z0-9][A-Za-z0-9._/-]*)\s+"
        r"(?P<brand>[A-Za-z0-9ÇĞİÖŞÜçğıiöşü._/-]+)\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        r"(?P<unit_price>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s+"
        r"(?P<line_total>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s*$",
        line,
        re.IGNORECASE
    )

    if table_row:
        brand = clean_text(table_row.group("brand"))
        desc = clean_text(f"{brand} {table_row.group('desc')}")

        return {
            "urunKodu": clean_text(table_row.group("code")),
            "urunAciklamasi": desc,
            "birim": "adet",
            "firmaAdedi": clean_number(table_row.group("qty")),
            "paraBirimi": currency,
            "birimFiyat": clean_number(table_row.group("unit_price")),
            "iskonto": 0,
            "netBirimFiyat": clean_number(table_row.group("unit_price")),
            "netToplam": clean_number(table_row.group("line_total")),
            "vade": "",
            "termin": "",
        }

    structured = re.match(
        r"^\s*(?:\d+\s+)?"
        r"(?P<code>[A-Za-z]{1,8}-?\d{1,8}\*?)\s+"
        r"(?P<desc>.+?)\s+"
        r"(?P<qty>\d+(?:[.,]\d+)?)\s+"
        r"(?P<unit>adet|ad|pcs|kutu|metre|mt|m)\s+"
        r"(?P<unit_price>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s+"
        r"%(?P<discount>\d+(?:[.,]\d+)?)\s+"
        r"(?P<net_price>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s+"
        r"(?P<line_total>\d[\d.,]*)\s*(?:₺|TL|TRY|\$|USD|€|EUR)?\s*$",
        line,
        re.IGNORECASE
    )

    if structured:
        return {
            "urunKodu": clean_text(structured.group("code")),
            "urunAciklamasi": clean_text(structured.group("desc")),
            "birim": clean_text(structured.group("unit")) or "adet",
            "firmaAdedi": clean_number(structured.group("qty")),
            "paraBirimi": currency,
            "birimFiyat": clean_number(structured.group("unit_price")),
            "iskonto": clean_number(structured.group("discount")),
            "netBirimFiyat": clean_number(structured.group("net_price")),
            "netToplam": clean_number(structured.group("line_total")),
            "vade": "",
            "termin": "",
        }

    # Fiyat para birimiyle gelirse
    price_match = re.search(
        r"(?P<price>\d+(?:[.,]\d+)?)\s*(?P<currency>₺|TL|TRY|\$|USD|€|EUR)",
        line,
        re.IGNORECASE
    )

    # Bazı PDF'lerde fiyat para birimsiz olur: ürün miktar adet fiyat iskonto toplam
    if price_match:
        price = clean_number(price_match.group("price"))
        before_price = line[:price_match.start()].strip()
        after_price = line[price_match.end():].strip()
    else:
        numbers = re.findall(r"\d+(?:[.,]\d+)?", line)
        if len(numbers) < 2:
            return None

        price = clean_number(numbers[-1])
        before_price = line.rsplit(numbers[-1], 1)[0].strip()
        after_price = line.rsplit(numbers[-1], 1)[1].strip()

    discount = 0.0
    discount_match = re.search(r"(\d+(?:[.,]\d+)?)\s*%", line)
    if discount_match:
        discount = clean_number(discount_match.group(1))

    term = ""
    term_match = re.search(
        r"(\d+\s*-\s*\d+\s*gün|\d+\s*gün|\d+\s*hafta|stok|hemen|hazır|hazir)",
        line,
        re.IGNORECASE
    )
    if term_match:
        term = clean_text(term_match.group(1))

    tokens = before_price.split()

    if len(tokens) < 2:
        return None

    unit = "adet"

    if tokens[-1].lower() in ["adet", "ad", "pcs", "kutu", "metre", "mt", "m"]:
        unit = tokens[-1]
        qty_token = tokens[-2]
        product_tokens = tokens[:-2]
    else:
        qty_token = tokens[-1]
        product_tokens = tokens[:-1]

    qty = clean_number(qty_token)

    if qty <= 0 or price <= 0 or not product_tokens:
        return None

    code = ""
    desc_tokens = product_tokens

    first = product_tokens[0]
    if re.fullmatch(r"[A-Za-z]{1,8}[-]?\d{1,8}\*?", first):
        code = first
        desc_tokens = product_tokens[1:]

    desc = clean_text(" ".join(desc_tokens))

    if not desc:
        return None

    return {
        "urunKodu": code,
        "urunAciklamasi": desc,
        "birim": unit,
        "firmaAdedi": qty,
        "paraBirimi": currency,
        "birimFiyat": price,
        "iskonto": discount,
        "vade": "",
        "termin": term,
    }


def find_header_column(header, required_words):
    for index, cell in enumerate(header):
        low = normalize_tr(cell)

        if all(word in low for word in required_words):
            return index

    return -1


def cell_at(row, index):
    if index < 0 or index >= len(row):
        return ""

    return clean_text(row[index])


def make_offer_row(parsed, firma, footer, file_name):
    return {
        "firma": firma,
        "firmaAdi": firma,
        "urunKodu": parsed["urunKodu"],
        "urunAciklamasi": parsed["urunAciklamasi"],
        "birim": parsed["birim"] or "adet",
        "firmaAdedi": parsed["firmaAdedi"],
        "paraBirimi": parsed["paraBirimi"] or "TRY",
        "birimFiyat": parsed["birimFiyat"],
        "iskonto": parsed["iskonto"],
        "netBirimFiyat": parsed.get("netBirimFiyat", 0),
        "netToplam": parsed.get("netToplam", 0),
        "vade": footer.get("vade", ""),
        "termin": parsed["termin"] or footer.get("termin", ""),
        "firmaDipToplam": footer.get("dipToplam", 0),
        "firmaKdv": footer.get("kdv", 0),
        "firmaGenelToplam": footer.get("genelToplam", 0),
        "kaynakDosya": file_name,
        "kaynakTipi": "pdf",
    }


def parse_product_tables(tables, firma, footer, file_name):
    rows = []
    sections = []
    errors = []
    warnings = []
    pending_rows = []
    active_header = None
    active_indexes = None

    def attach_section_to_pending(section):
        if not pending_rows:
            warnings.append(f"{section['section_name']} toplamı bulundu ama üstünde bağlanacak malzeme satırı yok.")
            return

        for row in pending_rows:
            row["section_name"] = section["section_name"]
            row["section_total"] = section["section_total"]
            row["birimFiyat"] = 0
            row["netBirimFiyat"] = 0
            row["netToplam"] = 0
            row["price_status"] = "section_total_only"

        warnings.append(
            f"{section['section_name']} toplamı üstündeki {len(pending_rows)} malzemeye bağlandı; parça fiyatları aktarılmadı."
        )
        pending_rows.clear()

    for table in tables:
        if not table:
            continue

        header = None
        data_rows = []

        for index, raw_row in enumerate(table):
            cells = [clean_text(cell) for cell in raw_row]
            joined = " ".join(cells)

            if is_product_table_header(joined):
                header = cells
                data_rows = table[index + 1:]
                break

        if header:
            code_index = find_header_column(header, ["malzeme", "kod"])
            brand_index = find_header_column(header, ["marka"])
            desc_index = find_header_column(header, ["aciklama"])
            qty_index = find_header_column(header, ["adet"])
            unit_price_index = find_header_column(header, ["net", "fiyat"])
            total_index = find_header_column(header, ["tutar"])

            if qty_index < 0 or desc_index < 0:
                active_header = None
                active_indexes = None
                continue

            active_header = header
            active_indexes = {
                "code": code_index,
                "brand": brand_index,
                "desc": desc_index,
                "qty": qty_index,
                "unit_price": unit_price_index,
                "total": total_index,
            }
        elif active_header and active_indexes:
            data_rows = table
        else:
            continue

        code_index = active_indexes["code"]
        brand_index = active_indexes["brand"]
        desc_index = active_indexes["desc"]
        qty_index = active_indexes["qty"]
        unit_price_index = active_indexes["unit_price"]
        total_index = active_indexes["total"]

        for raw_row in data_rows:
            cells = [clean_text(cell) for cell in raw_row]
            joined = " ".join(cells)

            if not joined or is_product_table_header(joined):
                continue

            quantity = clean_number(cell_at(cells, qty_index))
            code = cell_at(cells, code_index)
            brand = cell_at(cells, brand_index)
            description = cell_at(cells, desc_index)
            unit_price = clean_number(cell_at(cells, unit_price_index))
            line_total = clean_number(cell_at(cells, total_index))
            section_source = description or brand or code or joined
            section_name = canonical_section_name(section_source)

            if section_name or looks_like_section_total_row(cells, code, brand, description, quantity, line_total):
                numbers = row_numbers(cells)
                section_total = choose_section_total(line_total, numbers)
                section_name = section_name or section_name_from_cells(cells)
                section = {
                    "section_name": section_name,
                    "section_total": section_total,
                }
                sections.append(section)
                attach_section_to_pending(section)
                continue

            if should_skip_line(joined):
                continue

            if not code or not brand or not description:
                errors.append(f"Şüpheli satır atlandı: kod/marka/açıklama eksik ({joined})")
                continue

            name = clean_text(f"{brand} {description}") if brand else description

            if should_skip_line(name) or is_section_name(name):
                errors.append(f"Kategori/toplam satırı ürün olarak algılandı: {name}")
                continue

            if quantity <= 0:
                errors.append(f"Şüpheli satır atlandı: adet eksik ({name})")
                continue

            price_status = "line_priced"

            if unit_price <= 0 or line_total <= 0:
                unit_price = 0
                line_total = 0
                price_status = "pending_section_total"

            expected_total = quantity * unit_price

            if price_status == "line_priced" and not money_equals(expected_total, line_total, 0.10):
                unit_price = line_total / quantity

            rows.append(make_offer_row(
                {
                    "urunKodu": code,
                    "urunAciklamasi": name,
                    "birim": "adet",
                    "firmaAdedi": quantity,
                    "paraBirimi": detect_currency(joined),
                    "birimFiyat": unit_price,
                    "iskonto": 0,
                    "netBirimFiyat": unit_price,
                    "netToplam": line_total,
                    "vade": "",
                    "termin": "",
                },
                firma,
                footer,
                file_name,
            ))
            rows[-1]["section_name"] = ""
            rows[-1]["section_total"] = 0
            rows[-1]["price_status"] = price_status
            pending_rows.append(rows[-1])

    if sections and pending_rows:
        for row in pending_rows:
            row["birimFiyat"] = 0
            row["netBirimFiyat"] = 0
            row["netToplam"] = 0
            row["price_status"] = "section_total_only"

        warnings.append(
            f"{len(pending_rows)} malzeme satırı için sonraki kategori toplamı bulunamadı; parça fiyatları güvenli olarak aktarılmadı."
        )
        pending_rows.clear()

    ungrouped_pending = [row for row in pending_rows if row.get("price_status") == "pending_section_total"]
    if ungrouped_pending:
        errors.append(f"{len(ungrouped_pending)} malzeme satırı fiyat/toplam satırıyla eşleşmedi.")

    checked_total = footer.get("dipToplam") or footer.get("genelToplam") or 0
    product_total = sum(float(row.get("netToplam") or 0) for row in rows)

    if checked_total > 0 and product_total > 0 and not money_equals(product_total, checked_total, 0.50):
        errors.append(
            f"Genel toplam tutmuyor: ürünler {product_total:.2f}, teklif {checked_total:.2f}"
        )

    return {
        "rows": rows,
        "sections": sections,
        "errors": errors,
        "warnings": warnings,
    }


def parse_pdf(file_path, firma_adi="", file_name=""):
    audit = parse_pdf_with_audit(file_path, firma_adi, file_name)
    return audit["rows"]


def parse_pdf_with_audit(file_path, firma_adi="", file_name=""):
    rows = []
    sections = []
    errors = []
    warnings = []

    with pdfplumber.open(file_path) as pdf:
        full_text = "\n".join([page.extract_text() or "" for page in pdf.pages])
        tables = []

        for page in pdf.pages:
            tables.extend(page.extract_tables() or [])

    firma = detect_company_name(full_text, firma_adi, file_name)
    footer = detect_footer_info(full_text)
    table_result = parse_product_tables(tables, firma, footer, file_name)
    rows.extend(table_result["rows"])
    sections.extend(table_result["sections"])
    errors.extend(table_result["errors"])
    warnings.extend(table_result.get("warnings", []))
    lines = [clean_text(x) for x in full_text.split("\n") if clean_text(x)]
    has_product_table_header = any(is_product_table_header(line) for line in lines)

    if rows:
        return {
            "rows": rows,
            "sections": sections,
            "errors": errors,
            "warnings": warnings,
        }

    if has_product_table_header:
        return {
            "rows": [],
            "sections": sections,
            "errors": errors + ["Ürün tablosu bulundu ama güvenilir ürün satırı çıkarılamadı."],
            "warnings": warnings,
        }

    in_product_table = not has_product_table_header

    for line in lines:
        if has_product_table_header and is_product_table_header(line):
            in_product_table = True
            continue

        if not in_product_table:
            continue

        parsed = parse_pdf_line(line)

        if not parsed:
            continue

        rows.append(make_offer_row(parsed, firma, footer, file_name))

    return {
        "rows": rows,
        "sections": sections,
        "errors": errors,
        "warnings": warnings,
    }
