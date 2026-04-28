# ── Multi-stage build for minimal image size ──────────────────────────────
# Stage 1: Build — install all deps including native extensions
FROM python:3.10-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .

# PyTorch with CUDA 12.4 for GPU-accelerated sentence-transformers on g4dn.xlarge
RUN pip install --no-cache-dir --prefix=/install \
    torch \
    --index-url https://download.pytorch.org/whl/cu124

RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime — slim image with only installed packages
FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1

COPY --from=builder /install /usr/local

WORKDIR /app
COPY . .

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENTRYPOINT ["python", "data_ingestion_pipeline.py"]
CMD ["--reset"]
