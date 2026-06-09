-- Rate limiting table + RPC for persistent rate limits across Vercel serverless instances
-- Run this once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 0,
  reset_at BIGINT NOT NULL
);

-- Only service role can read/write — no client access
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- RPC: atomically check + increment, return true if allowed
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_limit INT,
  p_window_ms BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now BIGINT := EXTRACT(EPOCH FROM NOW()) * 1000;
  v_count INT;
  v_reset_at BIGINT;
BEGIN
  -- Upsert: insert fresh or get existing
  INSERT INTO rate_limits (key, count, reset_at)
    VALUES (p_key, 1, v_now + p_window_ms)
    ON CONFLICT (key) DO UPDATE
      SET
        count    = CASE WHEN rate_limits.reset_at < v_now THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at < v_now THEN v_now + p_window_ms ELSE rate_limits.reset_at END
    RETURNING count, reset_at INTO v_count, v_reset_at;

  RETURN v_count <= p_limit;
END;
$$;
