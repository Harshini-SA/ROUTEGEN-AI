-- ============================================================================
-- RouteGen AI — Global Query Fingerprints
-- ----------------------------------------------------------------------------
-- A PERMANENT, GLOBAL semantic cache shared across ALL users (unlike the
-- session-scoped Smart Cache which lives in-process for 24h).
--
-- Any user's answered query becomes reusable by every future user asking a
-- semantically similar question. This proves enterprise-scale value: at
-- Stripe's ~30M queries/day, cross-user repetition compounds into massive
-- savings on top of per-session caching.
--
-- Run this in the Supabase SQL editor once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- OPTION A (default / portable): embeddings stored as JSONB.
-- Works on EVERY Supabase plan — no extensions required. Similarity search is
-- done in Python (backend/app/core/fingerprint_cache.py). This is what the
-- backend expects out of the box.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS query_fingerprints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text      TEXT NOT NULL,
  query_embedding JSONB NOT NULL,          -- 384-dim MiniLM vector as a JSON array
  response_text   TEXT NOT NULL,
  tier            TEXT NOT NULL,
  model_used      TEXT NOT NULL,
  original_cost   FLOAT NOT NULL,
  hit_count       INTEGER DEFAULT 0,
  total_savings   FLOAT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_hit_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Fast recency pruning (30-day TTL is enforced in Python, but this keeps
-- ORDER BY created_at cheap as the table grows).
CREATE INDEX IF NOT EXISTS idx_query_fingerprints_created_at
  ON query_fingerprints (created_at DESC);


-- ============================================================================
-- OPTION B (optional upgrade): native pgvector similarity search.
-- ----------------------------------------------------------------------------
-- If your Supabase plan has the `vector` extension available, you can switch
-- to a true VECTOR column + ivfflat index for sub-linear similarity search.
-- If you enable this, also flip FingerprintCache.use_pgvector = True (it will
-- then use an RPC instead of scanning in Python). The default JSONB path above
-- already works without any of this.
--
--   CREATE EXTENSION IF NOT EXISTS vector;
--
--   ALTER TABLE query_fingerprints
--     ALTER COLUMN query_embedding TYPE VECTOR(384)
--     USING query_embedding::text::vector;
--
--   CREATE INDEX IF NOT EXISTS idx_query_fingerprints_embedding
--     ON query_fingerprints USING ivfflat (query_embedding vector_cosine_ops)
--     WITH (lists = 100);
--
--   -- RPC used by the backend when use_pgvector = True:
--   CREATE OR REPLACE FUNCTION match_query_fingerprint(
--     query_embedding VECTOR(384),
--     match_threshold FLOAT,
--     ttl_days INT
--   )
--   RETURNS TABLE (
--     id UUID, query_text TEXT, response_text TEXT, tier TEXT,
--     model_used TEXT, original_cost FLOAT, hit_count INT,
--     total_savings FLOAT, similarity FLOAT
--   )
--   LANGUAGE sql STABLE AS $$
--     SELECT f.id, f.query_text, f.response_text, f.tier, f.model_used,
--            f.original_cost, f.hit_count, f.total_savings,
--            1 - (f.query_embedding <=> query_embedding) AS similarity
--     FROM query_fingerprints f
--     WHERE f.created_at > NOW() - (ttl_days || ' days')::interval
--       AND 1 - (f.query_embedding <=> query_embedding) >= match_threshold
--     ORDER BY f.query_embedding <=> query_embedding
--     LIMIT 1;
--   $$;
-- ============================================================================
