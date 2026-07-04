"""
RouteGen AI — FastAPI Application Entry Point

Initializes the FastAPI app, configures CORS, mounts API routers,
and manages startup/shutdown lifecycle events for database connections.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.postgres import init_postgres, close_postgres
from app.db.mongo import init_mongo, close_mongo
from app.db.redis import init_redis, close_redis

logger = logging.getLogger("routegen")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown of database connections."""
    # ── Startup ──────────────────────────────────────────────────────────
    logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO))
    logger.info("🚀 RouteGen AI starting up...")

    # --- Graceful DB connections (optional — app works without them) ---
    try:
        await init_postgres()
        logger.info("✅ PostgreSQL connected")
    except Exception as e:
        logger.warning(f"⚠️ PostgreSQL unavailable (skipping): {e}")

    try:
        await init_mongo()
        logger.info("✅ MongoDB connected")
    except Exception as e:
        logger.warning(f"⚠️ MongoDB unavailable (skipping): {e}")

    try:
        await init_redis()
        logger.info("✅ Redis connected")
    except Exception as e:
        logger.warning(f"⚠️ Redis unavailable (skipping): {e}")

    # ── API Key Presence Check ────────────────────────────────────────
    import os
    groq_ok = bool(os.environ.get("GROQ_API_KEY"))
    gemini_ok = bool(os.environ.get("GEMINI_API_KEY"))
    deepseek_ok = bool(os.environ.get("DEEPSEEK_API_KEY"))
    logger.info(f"🔑 API Keys → Groq={'✅' if groq_ok else '❌'}  Gemini={'✅' if gemini_ok else '❌'}  DeepSeek={'✅' if deepseek_ok else '❌'}")

    # ── HuggingFace Classifier Status ─────────────────────────────────
    hf_key = settings.huggingface_api_key
    hf_is_real = bool(hf_key) and hf_key.startswith("hf_") and "your_" not in hf_key and "here" not in hf_key
    if hf_is_real:
        logger.info("✅ HuggingFace classifier: ACTIVE (semantic zero-shot)")
    elif hf_key:
        logger.warning(f"⚠️ HuggingFace classifier: PLACEHOLDER KEY ('{hf_key[:12]}...') — using keyword fallback. Paste a real hf_ token in backend/.env")
    else:
        logger.warning("⚠️ HuggingFace classifier: NO KEY — using keyword fallback")

    logger.info(f"📊 Budget cap: ${settings.budget_cap_usd:.2f}")
    logger.info(f"🔍 Cache similarity threshold: {settings.cache_similarity_threshold}")
    logger.info("🟢 RouteGen AI ready! (Some services may be unavailable — core routing works)")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────
    logger.info("🔴 RouteGen AI shutting down...")
    try:
        await close_postgres()
    except Exception:
        pass
    try:
        await close_mongo()
    except Exception:
        pass
    try:
        await close_redis()
    except Exception:
        pass
    logger.info("👋 Goodbye!")


# ── App Initialization ──────────────────────────────────────────────────────
app = FastAPI(
    title="RouteGen AI",
    description="Intelligent Model Routing for Cost Optimization",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS Middleware ─────────────────────────────────────────────────────────
# CORS must be added before any auth so preflight OPTIONS requests get the
# right headers back. With allow_credentials=True, origins must be explicit
# (a "*" wildcard is invalid for credentialed requests). Both localhost and
# 127.0.0.1 are listed so the frontend works regardless of which host it uses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health Check ────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health_check():
    """Health check endpoint for Docker healthchecks and monitoring."""
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": "1.0.0",
        "environment": settings.app_env,
    }


from app.api.router import router as main_router
app.include_router(main_router)
