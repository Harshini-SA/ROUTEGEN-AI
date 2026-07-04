"""
RouteGen AI — Global Query Fingerprint Cache
--------------------------------------------------------------------------
A PERMANENT, GLOBAL semantic cache backed by Supabase, shared across ALL
users of the system — distinct from the in-process, session-scoped Smart
Cache (`smart_cache.py`, 24h TTL, per-process memory).

Concept: any user's answered query becomes reusable by every future user
asking a semantically similar question, for a long TTL (30 days). At
enterprise scale (e.g. Stripe's ~30M queries/day) cross-user query
repetition compounds into large savings on top of per-session caching.

Storage: embeddings are persisted as a JSON array in a JSONB column, so this
works on ANY Supabase plan without the pgvector extension. Similarity search
is done in Python (cosine). If pgvector is later enabled (see
migrations/query_fingerprints.sql, Option B), set `use_pgvector=True` to push
the search into Postgres via the `match_query_fingerprint` RPC.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

import numpy as np

from app.core.db import db
# Reuse the MiniLM model already loaded by the Smart Cache — one model in
# memory serves both caches (zero extra cost, same 384-dim embedding space).
from app.core.smart_cache import smart_cache

logger = logging.getLogger(__name__)

TABLE = "query_fingerprints"


def _to_vector(raw) -> np.ndarray:
    """Normalize a stored embedding (JSONB list, JSON string, or pgvector
    text like '[0.1,0.2,...]') into a numpy array."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    return np.asarray(raw, dtype=np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


class FingerprintCache:
    def __init__(self, similarity_threshold: float = 0.90, ttl_days: int = 30,
                 use_pgvector: bool = False):
        self.model = smart_cache.model
        self.threshold = similarity_threshold
        self.ttl = timedelta(days=ttl_days)
        self.ttl_days = ttl_days
        # Flip to True only after enabling Option B in the migration.
        self.use_pgvector = use_pgvector

    # -- read -----------------------------------------------------------------
    async def find_global_match(self, query: str):
        """Search ALL users' fingerprints for a semantically similar query,
        regardless of who asked it or when (within the TTL). Returns the best
        matching row (with a `similarity` field) or None."""
        if not db:
            return None

        query_embedding = self.model.encode([query], convert_to_numpy=True)[0]

        if self.use_pgvector:
            match = self._pgvector_match(query_embedding)
        else:
            match = self._python_match(query_embedding)

        if not match:
            return None

        row, similarity = match

        # Register the hit — another user's answer just got reused.
        new_hits = (row.get("hit_count") or 0) + 1
        new_savings = (row.get("total_savings") or 0) + (row.get("original_cost") or 0)
        try:
            db.table(TABLE).update({
                "hit_count": new_hits,
                "total_savings": new_savings,
                "last_hit_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", row["id"]).execute()
        except Exception as e:
            logger.warning(f"[Fingerprint] hit bookkeeping failed: {e}")

        row["hit_count"] = new_hits
        row["total_savings"] = new_savings
        row["similarity"] = similarity

        logger.info(
            f"[Fingerprint] GLOBAL HIT! similarity={similarity:.3f} "
            f"(originally asked by another user) hit #{new_hits} "
            f"query='{query[:50]}' matched='{row.get('query_text', '')[:50]}'"
        )
        return row

    def _python_match(self, query_embedding: np.ndarray):
        """Portable path: fetch fingerprints and score cosine similarity in
        Python. Skips embeddings on the read to keep the payload small until
        we need them (we still need them here, so select all)."""
        try:
            result = db.table(TABLE).select("*").order(
                "created_at", desc=True
            ).limit(2000).execute()
        except Exception as e:
            logger.warning(f"[Fingerprint] fetch failed (table missing?): {e}")
            return None

        rows = result.data or []
        if not rows:
            return None

        cutoff = datetime.now(timezone.utc) - self.ttl
        best_similarity = 0.0
        best_row = None

        for row in rows:
            if self._is_expired(row, cutoff):
                continue
            try:
                stored = _to_vector(row["query_embedding"])
            except Exception:
                continue
            similarity = _cosine(query_embedding, stored)
            if similarity > best_similarity:
                best_similarity = similarity
                best_row = row

        if best_row is not None and best_similarity >= self.threshold:
            return best_row, best_similarity

        logger.info(f"[Fingerprint] MISS. best similarity={best_similarity:.3f}")
        return None

    def _pgvector_match(self, query_embedding: np.ndarray):
        """Native path: let Postgres do the nearest-neighbour search. Requires
        Option B in the migration (VECTOR column + match_query_fingerprint RPC)."""
        try:
            res = db.rpc("match_query_fingerprint", {
                "query_embedding": query_embedding.tolist(),
                "match_threshold": self.threshold,
                "ttl_days": self.ttl_days,
            }).execute()
        except Exception as e:
            logger.warning(f"[Fingerprint] pgvector RPC failed, no match: {e}")
            return None
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        return row, float(row.get("similarity", 0.0))

    def _is_expired(self, row: dict, cutoff: datetime) -> bool:
        created = row.get("created_at")
        if not created:
            return False
        try:
            ts = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return ts < cutoff
        except Exception:
            return False

    # -- write ----------------------------------------------------------------
    async def store_fingerprint(self, query: str, response: str, tier: str,
                                model: str, cost: float) -> None:
        """Store this Q&A as a globally reusable fingerprint for future users."""
        if not db:
            return
        if len(query.split()) < 4:
            return  # Skip trivial/greeting queries
        if not response:
            return

        embedding = self.model.encode([query], convert_to_numpy=True)[0].tolist()

        try:
            db.table(TABLE).insert({
                "query_text": query,
                "query_embedding": embedding,
                "response_text": response,
                "tier": tier,
                "model_used": model,
                "original_cost": cost,
                "hit_count": 0,
                "total_savings": 0,
            }).execute()
            logger.info(f"[Fingerprint] STORED globally: '{query[:50]}'")
        except Exception as e:
            # Persistence must never sink the request.
            logger.warning(f"[Fingerprint] store failed: {e}")

    # -- stats ----------------------------------------------------------------
    async def get_global_stats(self) -> dict:
        empty = {"total_fingerprints": 0, "total_hits": 0,
                 "total_savings": 0.0, "top_queries": []}
        if not db:
            return empty

        try:
            # Don't drag every embedding across the wire for stats.
            result = db.table(TABLE).select(
                "query_text, tier, model_used, original_cost, hit_count, total_savings"
            ).execute()
        except Exception as e:
            logger.warning(f"[Fingerprint] stats fetch failed: {e}")
            return empty

        rows = result.data or []
        if not rows:
            return empty

        total_hits = sum((r.get("hit_count") or 0) for r in rows)
        total_savings = sum((r.get("total_savings") or 0) for r in rows)
        top = sorted(rows, key=lambda r: (r.get("hit_count") or 0), reverse=True)[:5]

        return {
            "total_fingerprints": len(rows),
            "total_hits": total_hits,
            "total_savings": total_savings,
            "top_queries": [
                {
                    "query_text": r.get("query_text", ""),
                    "hit_count": r.get("hit_count") or 0,
                    "total_savings": r.get("total_savings") or 0,
                    "tier": r.get("tier"),
                }
                for r in top
            ],
        }


# Global instance — shared across all requests and all users.
# Threshold tuned to 0.85 (from an initial 0.90): real paraphrase pairs measured with
# this MiniLM model (e.g. "What is Stripe's refund policy?" vs "How does Stripe handle
# refunds?") cosine at ~0.885 — a same-intent rewording, not a coincidental match — so
# 0.90 was too strict to catch genuine paraphrases at demo scale.
fingerprint_cache = FingerprintCache(similarity_threshold=0.85, ttl_days=30)
