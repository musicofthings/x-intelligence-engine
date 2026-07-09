-- 0004_manual_alerts.sql — allow standalone analyst-created alerts not tied to a post.
-- Rebuilds `alerts` with a nullable post_id (SQLite can't drop NOT NULL in place).
-- `alerts` is a leaf table (nothing references it), so the rebuild is safe.

CREATE TABLE alerts_new (
  id TEXT PRIMARY KEY,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','medium','high','critical')),
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','dismissed','resolved')),
  delivery_status TEXT,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  UNIQUE (post_id, monitor_id)
);

INSERT INTO alerts_new
  (id, post_id, monitor_id, severity, title, reason, status, delivery_status,
   delivery_attempts, created_at, acknowledged_at, resolved_at)
SELECT id, post_id, monitor_id, severity, title, reason, status, delivery_status,
   delivery_attempts, created_at, acknowledged_at, resolved_at
FROM alerts;

DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;
CREATE INDEX idx_alerts_status ON alerts (status);
