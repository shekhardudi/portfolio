FROM python:3.12.9-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast resolver) — pyproject.toml uses uv-style overrides
RUN pip install --no-cache-dir uv fastapi "uvicorn[standard]"

# Project metadata + source
COPY pyproject.toml ./
COPY src ./src

# Install the package + its deps. Skip Streamlit-only group if pyproject grows one.
RUN uv pip install --system --no-cache-dir .

# FastAPI wrapper
COPY api.py ./api.py

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV BACKEND_PORT=8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:${BACKEND_PORT}/health || exit 1

CMD uvicorn api:app --host 0.0.0.0 --port ${BACKEND_PORT}
