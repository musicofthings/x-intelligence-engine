-- LiveRound initial schema (Neon Postgres)
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  image text,
  created_at timestamptz NOT NULL,
  plan text NOT NULL DEFAULT 'trial',
  trial_started_at timestamptz NOT NULL,
  plan_credits integer NOT NULL DEFAULT 0,
  permanent_credits integer NOT NULL DEFAULT 0,
  onboarding_complete boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  handle text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  scopes jsonb NOT NULL DEFAULT '[]',
  voice_profile jsonb NOT NULL,
  active_session_id text,
  token_expires_at timestamptz,
  oauth_encrypted text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  acting_account_id text NOT NULL,
  building text NOT NULL,
  reaching text NOT NULL,
  strategy_x text NOT NULL DEFAULT '',
  strategy_reddit text NOT NULL DEFAULT '',
  filter_doc text NOT NULL DEFAULT '',
  search_rules jsonb NOT NULL DEFAULT '[]',
  subreddits jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS writing_settings (
  user_id text PRIMARY KEY REFERENCES users(id),
  bio text NOT NULL DEFAULT '',
  writing_notes text NOT NULL DEFAULT '',
  reply_length integer NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS round_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  campaign_id text NOT NULL,
  acting_account_id text NOT NULL,
  networks jsonb NOT NULL,
  state text NOT NULL,
  started_at timestamptz NOT NULL,
  paused_at timestamptz,
  stopped_at timestamptz,
  live_ms integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  replies_count integer NOT NULL DEFAULT 0,
  queue_count integer NOT NULL DEFAULT 0,
  last_tick_minute integer NOT NULL DEFAULT -1
);

CREATE TABLE IF NOT EXISTS inbox_cards (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  user_id text NOT NULL,
  campaign_id text NOT NULL,
  post jsonb NOT NULL,
  score jsonb NOT NULL,
  draft text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new',
  offered_at timestamptz NOT NULL,
  acted_at timestamptz,
  reply_target_id text,
  frequent boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS reply_log (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  session_id text NOT NULL,
  card_id text NOT NULL,
  network text NOT NULL,
  external_post_id text NOT NULL,
  body text NOT NULL,
  confirmed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  network text NOT NULL,
  handle text NOT NULL,
  until timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  session_id text,
  interval_id text,
  pool text NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_session_interval
  ON credit_ledger (session_id, interval_id);

CREATE TABLE IF NOT EXISTS magic_tokens (
  token text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL
);
