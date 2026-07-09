-- 0005_watchlist_pipeline.sql — watchlist-driven collection + cron on/off switches.

-- Per-account collection checkpoints (avoid re-reading; poll on an interval).
ALTER TABLE watchlist_accounts ADD COLUMN since_id TEXT;
ALTER TABLE watchlist_accounts ADD COLUMN last_polled_at TEXT;

-- Cron master switches (spec §30 cost-awareness). Automatic collection defaults OFF so
-- nothing runs unsupervised until an analyst turns it on. Digest/maintenance are free
-- (no X/Claude spend) and default on.
INSERT INTO app_settings (key, value_json, is_secret_reference, updated_at) VALUES
  ('cron.collection_enabled', 'false', 0, '2026-01-01T00:00:00Z'),
  ('cron.digest_enabled', 'true', 0, '2026-01-01T00:00:00Z'),
  ('cron.maintenance_enabled', 'true', 0, '2026-01-01T00:00:00Z'),
  ('watchlist.poll_interval_minutes', '180', 0, '2026-01-01T00:00:00Z'),
  ('watchlist.max_results_per_account', '10', 0, '2026-01-01T00:00:00Z')
ON CONFLICT (key) DO NOTHING;
