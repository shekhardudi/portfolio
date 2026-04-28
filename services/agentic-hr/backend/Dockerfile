FROM python:3.12.9-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# CPU-only torch for sentence-transformers
RUN pip install --no-cache-dir \
    torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV BACKEND_PORT=8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${BACKEND_PORT}/health || exit 1

CMD uvicorn main:app --host 0.0.0.0 --port ${BACKEND_PORT}
