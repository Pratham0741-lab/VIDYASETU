FROM python:3.11-slim

# Prevent Python from writing .pyc and buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies (libgl1 for OpenCV headless, tesseract-ocr)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hin \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# Phase 17 (F3): dependency audit (pip-audit, in a throwaway venv - NOT RUN if
# the service cannot be reached) and licence inventory of the installed
# environment, at build time. Reports stay in the image under /app/security.
COPY security /tmp/security-tools
RUN sh /tmp/security-tools/pip_audit.sh /app/security \
 && python /tmp/security-tools/licences.py /app/security \
 && rm -rf /tmp/security-tools

# OCR models (PP-OCRv5 mobile detection + English recognition), fetched
# ONCE at build time into a read-only path. The running service never downloads
# (DISABLE_MODEL_SOURCE_CHECK) and has no internet access anyway.
ENV PADDLE_PDX_CACHE_HOME=/opt/paddlex     DISABLE_MODEL_SOURCE_CHECK=True     OMP_NUM_THREADS=4
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(text_detection_model_name='PP-OCRv5_mobile_det', text_recognition_model_name='en_PP-OCRv5_mobile_rec', use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)"  && chmod -R a+rX /opt/paddlex

# Copy application and model files
COPY app ./app
# Offline model assets at the path docker-compose.yml sets as ML_MODELS_DIR.
COPY app/models ./models

# Expose internal port
EXPOSE 8000

# Healthcheck (same convention as api/Dockerfile; docker-compose.yml's api
# service waits on ml being healthy). Uses the image's own Python - no curl.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"]

# Run FastAPI app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
