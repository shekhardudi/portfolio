FROM python:3.12.9-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast resolver) — pyproject.toml uses uv-style overrides
RUN python -m pip install uv fastapi "uvicorn[standard]"

# Project metadata + backend source
COPY pyproject.toml ./
COPY requirements.txt ./
COPY backend ./backend

# Install dependencies and package from the current backend-based layout.
RUN python -m pip install -r requirements.txt
RUN uv pip install --system --no-cache-dir .

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV BACKEND_PORT=8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:${BACKEND_PORT}/api/v1/health || exit 1

CMD uvicorn backend.api.main:app --host 0.0.0.0 --port ${BACKEND_PORT}
