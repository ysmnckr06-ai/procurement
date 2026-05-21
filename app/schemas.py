from pydantic import BaseModel
from typing import List, Optional


class OfferRow(BaseModel):
    firmaAdi: str
    urunKodu: str = ""
    urunAciklamasi: str = ""
    birim: str = ""
    talepEdilenAdet: float = 0
    firmaAdedi: float = 0
    paraBirimi: str = "TRY"
    birimFiyat: float = 0
    iskonto: float = 0
    vade: str = ""
    termin: str = ""
    kaynakDosya: str = ""
    kaynakTipi: str = ""


class AnalyzeResponse(BaseModel):
    success: bool
    rows: List[OfferRow]
    grouped: list
    warnings: List[str]
    reportPath: Optional[str] = None