-- 0007_engagement.sql — engagement layer (campaigns, voice profiles, AI reply drafts,
-- pre-send safety, session/goal tracking), X write auth, and Reddit as a second network.
--
-- Design note: `posts.x_post_id` is the *external* post id and stays globally unique.
-- Reddit ids arrive as fullnames (`t3_...`) which can never collide with X snowflake
-- ids, so the whole downstream pipeline (matches, prefilter, screening, alerts,
-- digests, feed) works unchanged for both networks.

-- ── Network generalization ───────────────────────────────────────────────────
-- `network` is the platform discriminator; `monitors.type` keeps its original CHECK
-- (it names an X API call shape). A Reddit monitor is type='recent_search' with
-- network='reddit', and picks keyword-search vs. subreddit-new from whether it has
-- keywords. SQLite cannot alter a CHECK constraint, and rebuilding `monitors` would
-- cascade-delete post_monitor_matches / ingestion_runs / alerts — not worth it for a
-- cosmetic type name.
ALTER TABLE posts ADD COLUMN network TEXT NOT NULL DEFAULT 'x';
ALTER TABLE monitors ADD COLUMN network TEXT NOT NULL DEFAULT 'x';
ALTER TABLE monitors ADD COLUMN subreddits_json TEXT;
ALTER TABLE monitors ADD COLUMN keywords_json TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_network ON posts(network, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitors_network ON monitors(network, enabled);

-- ── Voice profiles ───────────────────────────────────────────────────────────
-- The one-time "how do I sound" setup that drafting is conditioned on.
CREATE TABLE IF NOT EXISTS voice_profiles (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  tone               TEXT NOT NULL DEFAULT 'direct, factual, collegial',
  audience           TEXT,
  perspective        TEXT,
  do_json            TEXT NOT NULL DEFAULT '[]',
  dont_json          TEXT NOT NULL DEFAULT '[]',
  sample_replies_json TEXT NOT NULL DEFAULT '[]',
  max_chars          INTEGER NOT NULL DEFAULT 260,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- ── Campaigns ────────────────────────────────────────────────────────────────
-- Independent strategies. Each groups monitors (X and/or Reddit) and carries its own
-- voice, goal, and network set. Detaching a network leaves the campaign intact.
CREATE TABLE IF NOT EXISTS campaigns (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  description          TEXT,
  enabled              INTEGER NOT NULL DEFAULT 1,
  networks_json        TEXT NOT NULL DEFAULT '["x"]',
  goal_replies_per_day INTEGER NOT NULL DEFAULT 10,
  voice_profile_id     TEXT REFERENCES voice_profiles(id) ON DELETE SET NULL,
  strategy             TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_monitors (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  monitor_id  TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (campaign_id, monitor_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_monitors_monitor ON campaign_monitors(monitor_id);

-- ── Reply drafts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_drafts (
  id                TEXT PRIMARY KEY,
  post_id           TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  campaign_id       TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  voice_profile_id  TEXT REFERENCES voice_profiles(id) ON DELETE SET NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | discarded
  source            TEXT NOT NULL DEFAULT 'ai',     -- ai | manual | transform
  model             TEXT,
  prompt_version    TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reply_drafts_post ON reply_drafts(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reply_drafts_status ON reply_drafts(status, created_at DESC);

-- ── Sent replies ─────────────────────────────────────────────────────────────
-- `idempotency_key` is the at-least-once guard: a retried send can never double-post.
CREATE TABLE IF NOT EXISTS sent_replies (
  id                TEXT PRIMARY KEY,
  draft_id          TEXT REFERENCES reply_drafts(id) ON DELETE SET NULL,
  post_id           TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  campaign_id       TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  network           TEXT NOT NULL DEFAULT 'x',
  external_reply_id TEXT,
  body              TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  sent_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sent_replies_sent_at ON sent_replies(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_replies_post ON sent_replies(post_id);

-- ── Sessions + goals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagement_sessions (
  id               TEXT PRIMARY KEY,
  campaign_id      TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  goal             INTEGER NOT NULL DEFAULT 0,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  reviewed         INTEGER NOT NULL DEFAULT 0,
  replies_sent     INTEGER NOT NULL DEFAULT 0,
  skipped          INTEGER NOT NULL DEFAULT 0,
  follows          INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_engagement_sessions_started ON engagement_sessions(started_at DESC);

-- Per-item triage decisions. UNIQUE makes replayed writes idempotent and doubles as
-- the training signal for queue ranking (what the analyst engages vs. skips).
CREATE TABLE IF NOT EXISTS engagement_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT REFERENCES engagement_sessions(id) ON DELETE CASCADE,
  campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,  -- engaged | skipped | replied | followed | drafted
  metadata_json TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (session_id, post_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_engagement_events_kind ON engagement_events(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_post ON engagement_events(post_id);

-- ── OAuth (X user-context write) ─────────────────────────────────────────────
-- Tokens are stored AES-GCM encrypted (TOKEN_ENCRYPTION_KEY); ciphertext only, never
-- plaintext, and never returned to the browser.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                 TEXT PRIMARY KEY,
  account_key        TEXT NOT NULL UNIQUE,
  network            TEXT NOT NULL DEFAULT 'x',
  external_user_id   TEXT,
  username           TEXT,
  access_token_enc   TEXT NOT NULL,
  refresh_token_enc  TEXT,
  scope              TEXT,
  expires_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- Short-lived PKCE handshake state. Purged on use and by maintenance.
CREATE TABLE IF NOT EXISTS oauth_states (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ── Defaults ─────────────────────────────────────────────────────────────────
INSERT INTO app_settings (key, value_json, is_secret_reference, updated_at) VALUES
  ('engage.daily_goal', '10', 0, '2026-01-01T00:00:00Z'),
  ('engage.queue_limit', '50', 0, '2026-01-01T00:00:00Z'),
  ('engage.min_strategic_score', '40', 0, '2026-01-01T00:00:00Z'),
  ('engage.link_reuse_window_days', '7', 0, '2026-01-01T00:00:00Z'),
  ('engage.link_reuse_max', '3', 0, '2026-01-01T00:00:00Z'),
  ('engage.similarity_window', '50', 0, '2026-01-01T00:00:00Z'),
  ('cron.reddit_enabled', 'false', 0, '2026-01-01T00:00:00Z'),
  ('reddit.poll_interval_minutes', '60', 0, '2026-01-01T00:00:00Z'),
  ('reddit.max_results_per_run', '25', 0, '2026-01-01T00:00:00Z')
ON CONFLICT (key) DO NOTHING;
