# Engagement setup — campaigns, reply sending, Reddit

The engagement layer adds a triage inbox, AI reply drafting with pre-send safety checks,
one-click sending on X, session/goal tracking, and Reddit as a second collection network.

Everything except **sending** and **Reddit collection** works with the credentials the app
already has. Set up only what you need.

---

## 1. Voice profile and campaign (no new credentials)

1. **Campaigns → Voice profiles → Add profile.** Fill in tone, audience, what a reply
   should always do, what it must never do, and 2–5 style anchors (real replies you've
   written). Drafting is conditioned on this; it is the single biggest quality lever.
2. **Campaigns → Create.** Give it a strategy line, a daily reply goal, and attach the
   monitors whose posts should feed it.
3. **Engage.** Start a session and work the queue.

Without X OAuth configured, drafting, transforms, and safety checks all work — the
**Send reply** button is disabled and you copy the draft instead.

---

## 2. Sending replies on X (OAuth 2.0 user context)

Reading X uses the app-only bearer token. **Posting requires a different credential**: an
OAuth 2.0 user-context token with `tweet.write`. You need a paid X API tier that permits
writes.

### On the X developer portal

1. Open your app → **User authentication settings** → Set up.
2. **App permissions:** Read and write.
3. **Type of App:** Web App (confidential client) or Native App (public client). Either
   works; a confidential client also gives you a client secret.
4. **Callback URI / Redirect URL** — must match `X_OAUTH_REDIRECT_URI` character for
   character:
   ```
   https://<your-host>/api/oauth/x/callback
   ```
5. Save, then copy the **OAuth 2.0 Client ID** (and Client Secret, if confidential).

### Generate the token-encryption key

OAuth tokens are stored AES-256-GCM encrypted in D1. Generate a 32-byte key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> Losing this key makes stored tokens undecryptable — you'd have to reconnect the account.
> Rotating it has the same effect. It is not recoverable from the database.

### Set the secrets

```bash
wrangler secret put X_OAUTH_CLIENT_ID --config apps/api-worker/wrangler.jsonc
```

```bash
wrangler secret put X_OAUTH_CLIENT_SECRET --config apps/api-worker/wrangler.jsonc
```

```bash
wrangler secret put TOKEN_ENCRYPTION_KEY --config apps/api-worker/wrangler.jsonc
```

`X_OAUTH_REDIRECT_URI` is a plain var in `apps/api-worker/wrangler.jsonc` — update it if
your hostname differs. Omit `X_OAUTH_CLIENT_SECRET` entirely for a public (PKCE-only) app.

Only the **api-worker** needs these. The pipeline worker never sends.

### Connect the account

**Settings → Connected accounts → Connect X account.** You're sent to X's consent screen
and returned to Settings. The scopes requested are
`tweet.read tweet.write users.read offline.access` — `offline.access` is what makes the
refresh token available, without which the connection dies after ~2 hours.

### What the send path guarantees

- No endpoint sends without an explicit per-reply request. There is no bulk, scheduled, or
  auto-send path anywhere in the codebase.
- Every send runs the deterministic pre-send checks first. Hard blocks (empty, over the
  character limit) cannot be bypassed; advisory warnings are dismissible per reply.
- A `UNIQUE` idempotency claim is taken **before** the X call, so a retried request returns
  the original result instead of double-posting. A failed send releases the claim so you
  can retry.
- `ENGAGE_DAILY_SEND_CAP` (default 50) is a blunt backstop against a runaway session.
- Every send is written to the audit log.

---

## 3. Reddit collection

Reddit is a second network feeding the *same* pipeline — normalize → dedupe → prefilter →
Claude screening → alerts/digests/feed/engage queue. Reddit's API is free; the cost is the
downstream screening, which the existing Claude budget already gates.

### Create the app

1. <https://www.reddit.com/prefs/apps> → **create another app…**
2. Type: **script**. Redirect URI can be anything (unused for application-only auth).
3. Copy the client id (under the app name) and the secret.

### Set the secrets

Both workers need these — the pipeline worker collects, the api-worker powers subreddit
validation and the volume preview.

```bash
wrangler secret put REDDIT_CLIENT_ID --config apps/pipeline-worker/wrangler.jsonc
```

```bash
wrangler secret put REDDIT_CLIENT_SECRET --config apps/pipeline-worker/wrangler.jsonc
```

```bash
wrangler secret put REDDIT_USER_AGENT --config apps/pipeline-worker/wrangler.jsonc
```

Repeat for `apps/api-worker/wrangler.jsonc`.

`REDDIT_USER_AGENT` must be descriptive and identify you, e.g.
`xie/1.0 (by /u/yourhandle)`. Reddit throttles generic user agents aggressively.

### Create a Reddit monitor

`POST /api/monitors` with `network: "reddit"`, plus keywords and/or subreddits:

```json
{
  "name": "ctDNA on Reddit",
  "slug": "ctdna-reddit",
  "type": "recent_search",
  "network": "reddit",
  "keywords": ["ctDNA", "liquid biopsy", "MRD"],
  "subreddits": ["bioinformatics", "genomics", "cancer"],
  "poll_interval_minutes": 60,
  "max_results_per_run": 25
}
```

- With keywords → a keyword search, restricted to the subreddits if any are given.
- With subreddits only → the subreddit's new-post firehose.
- Neither → rejected at creation.

`monitors.type` keeps its original values (they name X API call shapes); the platform is
carried by `network`. A Reddit monitor is `type: "recent_search"`, `network: "reddit"`.

Before enabling it, check expected volume with `POST /api/reddit/preview` (keywords +
subreddits in, match count and a sample out), and validate subreddit names with
`POST /api/reddit/subreddits/validate`.

### Turn collection on

**Settings → Automation → Automatic Reddit collection.** This is a separate switch from X
collection; turning one off never stops the other. Both default to OFF.

---

## Reference

| Setting | Where | Default | What it does |
|---|---|---|---|
| `engage.daily_goal` | app_settings | 10 | Fallback reply target when a campaign sets none |
| `engage.queue_limit` | app_settings | 50 | Max candidates ranked per queue request |
| `engage.min_strategic_score` | app_settings | 40 | Screening floor for entering the queue |
| `engage.link_reuse_window_days` | app_settings | 7 | Window for the link-over-use check |
| `engage.link_reuse_max` | app_settings | 3 | Times one host may appear before warning |
| `engage.similarity_window` | app_settings | 50 | Recent replies compared for near-duplicates |
| `cron.reddit_enabled` | app_settings | false | Reddit collection master switch |
| `reddit.poll_interval_minutes` | app_settings | 60 | Default Reddit monitor interval |
| `ENGAGE_MAX_REPLY_CHARS` | env | 280 | Platform reply ceiling on X |
| `ENGAGE_DAILY_SEND_CAP` | env | 50 | Hard daily send backstop |

## Troubleshooting

**"No X account connected"** — Settings shows the connection state. If `configured` is
false, the listed env vars are missing.

**Sends started failing with an auth error** — the refresh token was revoked (password
change, app permissions changed, or the connection was revoked on X). Disconnect and
reconnect in Settings.

**Reddit monitor auto-paused** — a 401/403/404 from Reddit is permanent (bad credentials,
or a private/banned subreddit), so the monitor is disabled rather than retried forever.
The reason is on the monitor's `lastError`.

**Queue is empty but posts are being collected** — posts must be *screened* at or above
`engage.min_strategic_score` to enter the queue. Check that Claude screening is configured
and that the queue's time window (default 72h) covers your collection.
