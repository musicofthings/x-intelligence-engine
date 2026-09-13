-- LiveRound Phase 2: billing, OAuth state, post ideas, contacts
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_paused boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_period_end timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_recap_on text;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS min_followers integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  user_id text NOT NULL,
  provider text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS post_ideas (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  session_id text NOT NULL,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  fail_reason text,
  scheduled_at timestamptz,
  posted_at timestamptz,
  external_post_id text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS posting_settings (
  user_id text PRIMARY KEY REFERENCES users(id),
  posts_per_day integer NOT NULL DEFAULT 3,
  window_start text NOT NULL DEFAULT '09:00',
  window_end text NOT NULL DEFAULT '17:00',
  timezone text NOT NULL DEFAULT 'America/New_York'
);

CREATE TABLE IF NOT EXISTS contacts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  network text NOT NULL,
  handle text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  our_replies integer NOT NULL DEFAULT 0,
  their_replies integer NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_network_handle
  ON contacts (user_id, network, handle);
