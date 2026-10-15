"""Malzeme listesi / teklif içi tutarlılık kontrolleri.

Dosyadan okunan satırlar projeye aktarılmadan önce şu durumlar uyarılır:
- aynı ürün kodu farklı açıklamalarla geçiyor (yanlış kod ya da iki farklı ürün)
- aynı açıklama farklı kodlarla geçiyor (kod yazım hatası ya da muadil ürün)
- kodu olmayan kalemler (sistem KODSUZ-xxxx verdi; stok kartıyla eşleşmez)
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

AUTO_CODE = re.compile(r"^KODSUZ-\d+$", re.IGNORECASE)
MAX_LISTED = 5


def _fold(text: str) -> str:
    text = str(text or "").replace("İ", "i").replace("I", "ı").lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("ı", "i")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _code_key(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(code or "").upper())


def _similar(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def _short(text: str, limit: int = 40) -> str:
    text = str(text or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _listed(items: list[str]) -> str:
    shown = ", ".join(items[:MAX_LISTED])
    extra = len(items) - MAX_LISTED
    return f"{shown} ve {extra} kalem daha" if extra > 0 else shown


def check_item_consistency(rows: list[dict]) -> dict:
    """rows: product_code, product_name alanlı satırlar. Uyarı metinleri ve
    makinece okunur ayrıntı döndürür."""
    by_code: dict[str, list[dict]] = {}
    by_name: dict[str, list[dict]] = {}
    codeless: list[str] = []

    for row in rows:
        code = str(row.get("product_code") or "").strip()
        name = str(row.get("product_name") or "").strip()
        if not name:
            continue
        if not code or AUTO_CODE.match(code):
            codeless.append(name)
            continue
        by_code.setdefault(_code_key(code), []).append(row)
        by_name.setdefault(_fold(name), []).append(row)

    same_code_conflicts = []
    for key, group in by_code.items():
        names = []
        for row in group:
            folded = _fold(row.get("product_name"))
            if all(_similar(folded, _fold(seen)) < 0.75 for seen in names):
                names.append(row.get("product_name"))
        if len(names) > 1:
            same_code_conflicts.append({"code": group[0].get("product_code"), "names": names})

    same_name_conflicts = []
    for key, group in by_name.items():
        codes = sorted({_code_key(row.get("product_code")) for row in group})
        if key and len(codes) > 1:
            originals = []
            for row in group:
                code = str(row.get("product_code") or "").strip()
                if code not in originals:
                    originals.append(code)
            same_name_conflicts.append({"name": group[0].get("product_name"), "codes": originals})

    warnings = []
    if same_code_conflicts:
        details = [
            f"{item['code']}: " + " / ".join(_short(name) for name in item["names"][:3])
            for item in same_code_conflicts
        ]
        warnings.append(
            f"Aynı kod farklı açıklamayla geçiyor ({len(same_code_conflicts)} kod) — kodu veya ürünü kontrol edin: {_listed(details)}."
        )
    if same_name_conflicts:
        details = [f"{_short(item['name'])}: {' / '.join(item['codes'][:3])}" for item in same_name_conflicts]
        warnings.append(
            f"Aynı açıklama farklı kodlarla geçiyor ({len(same_name_conflicts)} ürün) — kod yazım hatası veya muadil olabilir: {_listed(details)}."
        )
    if codeless:
        warnings.append(
            f"Kodu olmayan {len(codeless)} kalem var; sistem geçici KODSUZ-xxxx kodu verdi, stok kartıyla eşleşmez: {_listed([_short(name) for name in codeless])}."
        )

    return {
        "warnings": warnings,
        "same_code_different_name": same_code_conflicts,
        "same_name_different_code": same_name_conflicts,
        "codeless_count": len(codeless),
    }
