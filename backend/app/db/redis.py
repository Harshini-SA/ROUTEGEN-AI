"""
RouteGen AI — Redis Connection (Async)

Provides an async Redis client for session caching, rate limiting,
and budget tracking per pipeline run.
"""

import redis.asyncio as aioredis

from app.config import settings

# ── Redis Client ────────────────────────────────────────────────────────────
redis_client: aioredis.Redis | None = None


async def init_redis():
    """Initialize the async Redis client."""
    global redis_client
    redis_client = aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
    )
    # Verify connection
    await redis_client.ping()


async def close_redis():
    """Close the Redis client on shutdown."""
    global redis_client
    if redis_client:
        await redis_client.close()


def get_redis() -> aioredis.Redis:
    """Return the Redis client instance."""
    return redis_client
