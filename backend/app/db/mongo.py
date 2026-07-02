"""
RouteGen AI — MongoDB Connection (Motor Async Driver)

Provides an async MongoDB client for storing raw prompt/response pairs
and flexible-schema trace data.
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings

# ── Client & Database ───────────────────────────────────────────────────────
client: AsyncIOMotorClient | None = None
db: AsyncIOMotorDatabase | None = None


async def init_mongo():
    """Initialize the async MongoDB client."""
    global client, db
    client = AsyncIOMotorClient(settings.mongo_uri)
    db = client.routegen

    # Verify connection
    await client.admin.command("ping")


async def close_mongo():
    """Close the MongoDB client on shutdown."""
    global client
    if client:
        client.close()


def get_mongo_db() -> AsyncIOMotorDatabase:
    """Return the MongoDB database instance."""
    return db
