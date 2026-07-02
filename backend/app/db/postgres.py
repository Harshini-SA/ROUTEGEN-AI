"""
RouteGen AI — PostgreSQL Connection (Async SQLAlchemy)

Provides async session factory for structured routing logs and pipeline run metadata.
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# ── Engine & Session Factory ────────────────────────────────────────────────
engine = None
async_session_factory = None


class Base(DeclarativeBase):
    """SQLAlchemy declarative base for all ORM models."""
    pass


async def init_postgres():
    """Initialize the async PostgreSQL engine and session factory."""
    global engine, async_session_factory
    engine = create_async_engine(
        settings.postgres_url,
        echo=(settings.app_env == "development"),
        pool_size=10,
        max_overflow=20,
    )
    async_session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # Create tables (dev convenience — use Alembic migrations in production)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_postgres():
    """Dispose the async engine on shutdown."""
    global engine
    if engine:
        await engine.dispose()


async def get_db() -> AsyncSession:
    """FastAPI dependency: yields an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
