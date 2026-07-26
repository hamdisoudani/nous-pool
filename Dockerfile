# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

# Cache-bust marker — bump when src/ files don't change but Railway BuildKit
# cached the COPY layer. The RUN below invalidates the next COPY src/ step.
ARG RAILWAY_CACHE_BUST=2026-07-26-12-00
RUN echo "RAILWAY_CACHE_BUST=$RAILWAY_CACHE_BUST" > /tmp/cache_bust.txt

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/src

WORKDIR /app

# System deps (Python + Node + curl for healthcheck)
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

ENV NOUS_POOL_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf "http://127.0.0.1:${PORT:-8000}/healthz" || exit 1

# Railway injects PORT=8080 by default — bind to whichever it says.
CMD ["sh", "-c", "exec python -m uvicorn nous_pool.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --log-level info"]
