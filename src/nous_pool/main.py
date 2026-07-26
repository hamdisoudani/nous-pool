"""FastAPI app: lifespan, routers, SPA mount."""
from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

# Auto-load .env from project root
_PROJECT_ROOT = Path(__file__).parent.parent.parent
try:
    from dotenv import load_dotenv
    _env_path = _PROJECT_ROOT / ".env"
    if _env_path.exists():
        load_dotenv(_env_path, override=False)
except ImportError:
    pass

from .admin.router import router as admin_router
from .config import load_settings, validate_required
from .proxy.router import router as proxy_router

logger = logging.getLogger("nous_pool")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("nous-pool starting up")
    s = load_settings()
    logger.info(f"supabase url: {s.supabase_url}")
    yield
    logger.info("nous-pool shutting down")


def create_app() -> FastAPI:
    s = load_settings()

    # Surface missing required env vars early
    missing = validate_required(s)
    if missing:
        print(f"\n[ERROR] Missing required env vars: {missing}\n", file=sys.stderr)
        # Don't fail here — let tests/dev runs work without Supabase

    app = FastAPI(
        title="Nous Pool Proxy",
        version="0.2.0",
        lifespan=lifespan,
    )
    app.state.settings = s

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                       s.public_base_url.rstrip("/")],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(admin_router)
    app.include_router(proxy_router)

    # SPA
    candidates = [
        Path(__file__).parent.parent.parent / "static",
        Path(__file__).parent / "static",
        Path(__file__).parent.parent.parent / "frontend" / "dist",
    ]
    static_dir = None
    for c in candidates:
        if c.exists() and any(c.iterdir()):
            static_dir = c
            break
    if static_dir is not None:
        async def serve_spa_or_asset(full_path: str = ""):
            if full_path:
                candidate = static_dir / full_path
                try:
                    candidate = candidate.resolve()
                    static_resolved = static_dir.resolve()
                    if not str(candidate).startswith(str(static_resolved)):
                        raise HTTPException(status_code=400)
                    if candidate.is_file():
                        return FileResponse(str(candidate))
                except (OSError, RuntimeError):
                    pass
            index = static_dir / "index.html"
            if index.exists():
                return FileResponse(str(index), media_type="text/html")
            raise HTTPException(status_code=404)

        @app.get("/ui", include_in_schema=False)
        async def spa_root():
            return await serve_spa_or_asset("")

        @app.get("/ui/{full_path:path}", include_in_schema=False)
        async def spa_sub(full_path: str):
            return await serve_spa_or_asset(full_path)

        logger.info(f"SPA served at /ui from {static_dir}")
    else:
        @app.get("/admin")
        def spa_fallback():
            return JSONResponse({
                "message": "Frontend not built. See static-spa/.",
                "build_command": "cd static-spa && npm install && npm run build",
            }, status_code=503)

    @app.get("/")
    def root():
        return RedirectResponse("/ui/login")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    s = load_settings()
    uvicorn.run("nous_pool.main:app", host=s.host, port=s.port, log_level="info")