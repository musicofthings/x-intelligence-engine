-- 0006_nullable_run_monitor.sql — allow ingestion_runs not tied to a monitor
-- (watchlist timeline collection). Rebuilds the leaf table with a nullable monitor_id.

CREATE TABLE ingestion_runs_new (
  id TEXT PRIMARY KEY,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE CASCADE,
  run_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  posts_requested INTEGER NOT NULL DEFAULT 0,
  posts_received INTEGER NOT NULL DEFAULT 0,
  posts_new INTEGER NOT NULL DEFAULT 0,
  posts_duplicate INTEGER NOT NULL DEFAULT 0,
  posts_enqueued INTEGER NOT NULL DEFAULT 0,
  estimated_x_cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  metadata_json TEXT
);

INSERT INTO ingestion_runs_new
  (id, monitor_id, run_key, status, started_at, completed_at, posts_requested, posts_received,
   posts_new, posts_duplicate, posts_enqueued, estimated_x_cost_usd, error, metadata_json)
SELECT id, monitor_id, run_key, status, started_at, completed_at, posts_requested, posts_received,
   posts_new, posts_duplicate, posts_enqueued, estimated_x_cost_usd, error, metadata_json
FROM ingestion_runs;

DROP TABLE ingestion_runs;
ALTER TABLE ingestion_runs_new RENAME TO ingestion_runs;
CREATE INDEX idx_ingestion_runs_status ON ingestion_runs (status);
CREATE INDEX idx_ingestion_runs_monitor ON ingestion_runs (monitor_id, started_at);
