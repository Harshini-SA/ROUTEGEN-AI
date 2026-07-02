"""
RouteGen AI — Application Configuration

Loads all settings from environment variables / .env file.
Provides a single `settings` instance used across the app.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ── App ──────────────────────────────────────────────────────────────
    app_name: str = "RouteGen AI"
    app_env: str = Field(default="development", alias="APP_ENV")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # ── LLM API Keys ────────────────────────────────────────────────────
    openai_api_key: Optional[str] = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: Optional[str] = Field(default=None, alias="ANTHROPIC_API_KEY")
    gemini_api_key: Optional[str] = Field(default=None, alias="GEMINI_API_KEY")

    # ── AWS Bedrock (Claude Models) ─────────────────────────────────────
    aws_bedrock_api_key: Optional[str] = Field(default=None, alias="AWS_BEDROCK_API_KEY")
    aws_region_name: str = Field(default="ap-south-1", alias="AWS_REGION_NAME")

    # ── Database URLs ───────────────────────────────────────────────────
    postgres_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/routegen",
        alias="POSTGRES_URL",
    )
    mongo_uri: str = Field(
        default="mongodb://root:example@localhost:27017",
        alias="MONGO_URI",
    )
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        alias="REDIS_URL",
    )
    chroma_url: str = Field(
        default="http://localhost:8001",
        alias="CHROMA_URL",
    )

    # ── Langfuse Observability ──────────────────────────────────────────
    langfuse_secret_key: Optional[str] = Field(default=None, alias="LANGFUSE_SECRET_KEY")
    langfuse_public_key: Optional[str] = Field(default=None, alias="LANGFUSE_PUBLIC_KEY")
    langfuse_host: str = Field(default="http://localhost:3001", alias="LANGFUSE_HOST")

    # ── Budget Kill-Switch ──────────────────────────────────────────────
    budget_cap_usd: float = Field(default=1.00, alias="BUDGET_CAP_USD")

    # ── Semantic Cache ──────────────────────────────────────────────────
    cache_similarity_threshold: float = Field(
        default=0.95, alias="CACHE_SIMILARITY_THRESHOLD"
    )

    # ── Supabase Auth & Database ────────────────────────────────────────
    supabase_url: Optional[str] = Field(default=None, alias="SUPABASE_URL")
    supabase_key: Optional[str] = Field(default=None, alias="SUPABASE_KEY")
    supabase_jwt_secret: Optional[str] = Field(default=None, alias="SUPABASE_JWT_SECRET")

    # ── Model Tier Configuration (Free + AWS Bedrock) ────────────────────
    # Maps tier names to lists of model identifiers (LiteLLM format)
    small_tier_models: list[str] = [
        "groq/llama-3.1-8b-instant",                    # Free, extremely fast
        "gemini/gemini-1.5-flash-latest",               # Free tier available
        "bedrock/anthropic.claude-3-5-haiku-20241022-v1:0",  # Claude Haiku (AWS $200 credits)
    ]
    large_tier_models: list[str] = [
        "gemini/gemini-1.5-pro-latest",                 # Generous free tier
        "groq/mixtral-8x7b-32768",                      # Free
        "bedrock/anthropic.claude-sonnet-4-5-20250514-v1:0",  # Claude Sonnet 4.5 (AWS credits)
    ]
    reasoning_tier_models: list[str] = [
        "groq/llama-3.3-70b-versatile",                 # Free, strong reasoning
        "bedrock/anthropic.claude-sonnet-4-5-20250514-v1:0",  # Claude Sonnet 4.5 (AWS credits)
    ]

    # ── Tier Score Boundaries ───────────────────────────────────────────
    small_tier_max: int = 4   # Score 1–4 → Small
    large_tier_max: int = 7   # Score 5–7 → Large
    # Score 8–10 → Reasoning (anything above large_tier_max)

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    def get_tier_for_score(self, score: float) -> str:
        """Map a complexity score (1-10) to a model tier name."""
        if score <= self.small_tier_max:
            return "small"
        elif score <= self.large_tier_max:
            return "large"
        else:
            return "reasoning"

    def get_models_for_tier(self, tier: str) -> list[str]:
        """Return the list of models available for a given tier."""
        tier_map = {
            "small": self.small_tier_models,
            "large": self.large_tier_models,
            "reasoning": self.reasoning_tier_models,
        }
        return tier_map.get(tier, self.small_tier_models)


# Singleton instance
settings = Settings()
