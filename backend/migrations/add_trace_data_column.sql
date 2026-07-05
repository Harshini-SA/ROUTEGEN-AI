-- ============================================================================
-- RouteGen AI — Persist full pipeline trace per message
-- ----------------------------------------------------------------------------
-- Bug: switching to a previous chat session showed "Unknown" tier, "$0.00000"
-- cost, and a permanently-spinning Query Parsing node, because only
-- model_used/tier/cost were (attempted to be) saved per message — the full
-- per-node routing_logs array was never persisted at all, and the tier/model
-- columns were never actually populated by the API layer to begin with.
--
-- This adds a JSONB column to store the full routing_logs array (or the
-- single-node cache-hit log entry) alongside each assistant message, so
-- reloading a session can render the ORIGINAL trace instead of reconstructing
-- a fake, mostly-empty one from a couple of scalar columns.
--
-- Run this in the Supabase SQL editor once. Safe or existing rows: old
-- messages simply get trace_data = NULL, which the frontend now shows as a
-- static "Historical message" badge instead of a broken spinner.
-- ============================================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS trace_data JSONB;
