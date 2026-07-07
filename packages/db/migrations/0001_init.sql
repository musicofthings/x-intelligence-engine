-- 0001_init.sql — core schema (spec §10). D1 / SQLite. X ids stored as TEXT.
-- Migrations are the source of truth; runtime never auto-creates schema.

PRAGMA foreign_keys = ON;

-- §10.1 monitors
CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('recent_search','user_watchlist','x_list','filtered_stream_rule')),
  enabled INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 50,
  x_query TEXT,
  x_list_id TEXT,
  poll_interval_minutes INTEGER NOT NULL DEFAULT 60,
  max_results_per_run INTEGER NOT NULL DEFAULT 25,
  max_pages_per_run INTEGER NOT NULL DEFAULT 1,
  prefilter_threshold INTEGER NOT NULL DEFAULT 40,
  ai_screening_threshold INTEGER NOT NULL DEFAULT 40,
  alert_threshold INTEGER NOT NULL DEFAULT 90,
  language TEXT,
  excluded_terms_json TEXT NOT NULL DEFAULT '[]',
  required_terms_json TEXT NOT NULL DEFAULT '[]',
  schedule_json TEXT,
  budget_json TEXT,
  since_id TEXT,
  pagination_state_json TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_monitors_enabled ON monitors (enabled);

-- §10.2 watchlists
CREATE TABLE watchlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- §10.3 watchlist_accounts
CREATE TABLE watchlist_accounts (
  id TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  x_user_id TEXT,
  username TEXT NOT NULL,
  display_name TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (watchlist_id, username)
);
CREATE INDEX idx_watchlist_accounts_watchlist ON watchlist_accounts (watchlist_id);

-- §10.4 posts
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  x_post_id TEXT NOT NULL UNIQUE,
  author_id TEXT,
  author_username TEXT,
  author_name TEXT,
  text TEXT NOT NULL,
  lang TEXT,
  created_at TEXT,
  conversation_id TEXT,
  in_reply_to_user_id TEXT,
  url TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  repost_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  quote_count INTEGER NOT NULL DEFAULT 0,
  bookmark_count INTEGER NOT NULL DEFAULT 0,
  impression_count INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_posts_created_at ON posts (created_at);
CREATE INDEX idx_posts_author_username ON posts (author_username);
CREATE INDEX idx_posts_conversation ON posts (conversation_id);

-- §10.5 post_monitor_matches
CREATE TABLE post_monitor_matches (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  matched_rule TEXT,
  match_metadata_json TEXT,
  matched_at TEXT NOT NULL,
  UNIQUE (post_id, monitor_id)
);
CREATE INDEX idx_pmm_monitor ON post_monitor_matches (monitor_id);
CREATE INDEX idx_pmm_post ON post_monitor_matches (post_id);

-- §10.6 prefilter_results
CREATE TABLE prefilter_results (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  keyword_score INTEGER NOT NULL DEFAULT 0,
  source_score INTEGER NOT NULL DEFAULT 0,
  engagement_score INTEGER NOT NULL DEFAULT 0,
  primary_source_score INTEGER NOT NULL DEFAULT 0,
  penalty_score INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL CHECK (decision IN ('pass','reject')),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  rules_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (post_id, rules_version)
);

-- §10.7 screening_results
CREATE TABLE screening_results (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  relevance_score INTEGER NOT NULL,
  novelty_score INTEGER NOT NULL,
  credibility_score INTEGER NOT NULL,
  strategic_importance_score INTEGER NOT NULL,
  topic TEXT,
  subtopic TEXT,
  requires_followup INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  summary TEXT,
  recommended_action TEXT,
  entities_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  raw_response_json TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  scored_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (post_id, model, prompt_version)
);
CREATE INDEX idx_screening_relevance ON screening_results (relevance_score);
CREATE INDEX idx_screening_strategic ON screening_results (strategic_importance_score);
CREATE INDEX idx_screening_topic ON screening_results (topic);
CREATE INDEX idx_screening_post ON screening_results (post_id);

-- §10.8 post_states
CREATE TABLE post_states (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_dismissed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

-- §10.9 alerts
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
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
CREATE INDEX idx_alerts_status ON alerts (status);

-- §10.10 digests
CREATE TABLE digests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('daily','weekly','custom')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  title TEXT NOT NULL,
  executive_summary TEXT,
  content_markdown TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_digests_period ON digests (period_start, period_end);

-- §10.11 digest_items
CREATE TABLE digest_items (
  id TEXT PRIMARY KEY,
  digest_id TEXT NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (digest_id, post_id)
);
CREATE INDEX idx_digest_items_digest ON digest_items (digest_id);

-- §10.12 ingestion_runs
CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
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
CREATE INDEX idx_ingestion_runs_status ON ingestion_runs (status);
CREATE INDEX idx_ingestion_runs_monitor ON ingestion_runs (monitor_id, started_at);

-- §10.13 jobs
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  last_error TEXT,
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_status ON jobs (status);

-- §10.14 api_usage
CREATE TABLE api_usage (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  resource_count INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_api_usage_occurred ON api_usage (occurred_at);
CREATE INDEX idx_api_usage_provider_date ON api_usage (provider, occurred_at);

-- §10.15 app_settings
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  is_secret_reference INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- §10.16 webhook_events
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_event_id TEXT,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error TEXT,
  UNIQUE (provider, payload_hash)
);
CREATE INDEX idx_webhook_events_status ON webhook_events (status);

-- §10.17 audit_log
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log (created_at);
