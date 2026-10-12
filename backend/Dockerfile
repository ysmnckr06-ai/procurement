# CORVIAN backend: FastAPI + OCR (Tesseract, Türkçe dil paketi) + PDF dönüştürme.
# Render'ın ücretsiz planı gibi 512 MB bellekli ortamlarda çalışacak şekilde ayarlandı.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TESSERACT_CMD=/usr/bin/tesseract \
    OCR_PDF_DPI=200 \
    OCR_PDF_MAX_PAGES=20

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-tur \
        poppler-utils \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# tesseract-bin yalnızca sistemde Tesseract olmayan ortamlar içindir; burada
# apt ile kurulan sürüm (Türkçe paketiyle) kullanılır.
RUN grep -v '^tesseract-bin' requirements.txt > requirements.docker.txt \
    && pip install -r requirements.docker.txt

COPY . .

RUN useradd --create-home appuser && mkdir -p app/temp && chown -R appuser /app
USER appuser

EXPOSE 10000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
