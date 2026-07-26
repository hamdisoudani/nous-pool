# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/src

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# ---- 1. Install Python deps ----
COPY pyproject.toml ./
RUN pip install --no-cache-dir \
        "fastapi>=0.110" \
        "uvicorn[standard]>=0.30" \
        "pydantic-settings>=2.4" \
        "argon2-cffi>=23.1.0" \
        "PyJWT>=2.9.0" \
        "python-multipart>=0.0.20" \
        "httpx>=0.27" \
        "supabase>=2.0" \
        "python-dotenv>=1.0"

# ---- 2. Build SPA ----
COPY static-spa/ ./static-spa/
WORKDIR /app/static-spa
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
RUN npm run build
WORKDIR /app

# ---- 3. Copy backend ----
COPY src/ ./src/

# ---- Runtime ----
EXPOSE 8000

ENV NOUS_POOL_HOST=0.0.0.0 \
    NOUS_POOL_PORT=8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://127.0.0.1:8000/healthz || exit 1

# Bind to Railway's PORT env var (Railway default for containers is often 8080)
CMD ["sh", "-c", "echo \"=== PORT env: ${PORT:-unset} ===\" && echo '=== Booting nous-pool ===' && exec python -m uvicorn nous_pool.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --log-level info 2>&1"]
