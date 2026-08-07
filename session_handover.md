# Session Handover
_Generated: 2026-08-07T12:25:00Z_
_Branch: main_
_Trigger: user request (pausing for live testing) | Context at compact: 86%_
_Compact count this project: 0_

---

## 🎯 Active Task
**What we're building/fixing:**
Shipped a Pounce.so-style engagement layer on top of the existing X intelligence
pipeline (campaigns, engage inbox, AI reply drafting + transforms, deterministic
pre-send safety checks, X reply sending via OAuth 2.0/PKCE, session/goal tracking),
plus Reddit as a second collection network. All code is built, tested, committed,
pushed, and deployed to production. X collection is live and confirmed working.

**Phase:** Phase 2 — live testing of the engagement path
**Next action:** Provision the engagement credentials (X OAuth + token key, Reddit
app), then run the OAuth connect → draft → send round trip. Nothing in that path
has ever touched a real X account.

---

## ✅ Completed This Session
- [x] Researched pounce.so feature set (site itself is blocked by the local FortiGuard
      filter; list assembled from indexed copy + BetaList/directory listings)
- [x] `packages/engage` — pure queue ranking (`engage-rank-v1`) + pre-send safety
      (`engage-safety-v1`) + Claude reply drafting (`x-intel-reply-v1`)
- [x] `packages/reddit-client` — official Reddit API, normalized onto `NormalizedXPost`
- [x] `packages/x-client` — OAuth 2.0 + PKCE (authorize/exchange/refresh/revoke) and
      `XWriteClient.replyTo`
- [x] `packages/shared` — AES-256-GCM secret envelope + PKCE helpers
- [x] `packages/db` — migration `0007_engagement` + `EngagementRepo` (`repo.engage`)
- [x] `apps/api-worker` — `src/engage-routes.ts` (campaigns, voice, queue, drafts,
      transforms, safety, send, sessions/stats, X OAuth, Reddit validate/preview)
- [x] `apps/pipeline-worker` — Reddit dispatcher + collector behind `cron.reddit_enabled`
- [x] `apps/web` — Engage, Campaigns, Engagement pages + Connected accounts in Settings
- [x] Fixed the broken global pnpm/wrangler (pnpm store `store/v11` had been wiped,
      leaving every global package a dangling symlink) — reinstalled both
- [x] Committed migration 0006, which had been left untracked and never applied remotely
- [x] Applied migrations 0006 + 0007 to remote D1; verified data intact
- [x] Deployed both workers; verified the new build executes via `wrangler tail`
- [x] Fixed pipeline worker running as `APP_ENV=development` in production and closed
      its open `workers.dev` endpoint (+ 9 config-guard tests)
- [x] Fixed a latent production bug: an aged-out `since_id` returned 400, was treated as
      transient, and retried forever with no code path to clear the bad checkpoint
      (+ 7 regression tests)
- [x] Enabled `cron.collection_enabled` and `cron.reddit_enabled`; confirmed live
      collection → prefilter → Claude screening working end to end

---

## 🔄 In Progress (Exact Resume Point)
**Branch:** `main`
**Last commit:** `ecce06b fix(pipeline): self-heal a since_id checkpoint that aged out of X's window`
**Next immediate action:** Nothing is half-done. Working tree is clean and `origin/main`
is in sync. Resume by provisioning engagement credentials (see Remaining Work #1).

---

## 📋 Remaining Work
1. **Provision engagement credentials** (`docs/ENGAGEMENT_SETUP.md`):
   - X developer portal: enable Read+Write, register callback
     `https://app.seyarkainunnarivu.com/api/oauth/x/callback` **character for character**,
     copy OAuth 2.0 Client ID/Secret. Requires a write-enabled X tier.
   - `TOKEN_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
     — losing or rotating it makes stored tokens undecryptable; not recoverable from D1.
   - `wrangler secret put X_OAUTH_CLIENT_ID | X_OAUTH_CLIENT_SECRET | TOKEN_ENCRYPTION_KEY`
     on **api-worker only** (the pipeline worker never sends).
2. **Live-test the send path** — Settings → Connect X account → Engage → draft →
   transforms → safety warnings → send. Verify the reply appears on X, `sent_replies`
   gets `external_reply_id`, and a second send of the same draft returns
   `already_sent: true` rather than double-posting.
3. **Reddit** — create a script app at reddit.com/prefs/apps, set `REDDIT_CLIENT_ID`,
   `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` on **both** workers, then create a Reddit
   monitor (`network: "reddit"` + keywords and/or subreddits). `cron.reddit_enabled` is
   already true, currently logging `dispatch.reddit_not_configured`.
4. **Create a voice profile before drafting** — it is the single biggest quality lever;
   drafts fall back to a generic default without one.
5. Optional: Miniflare integration tests for the new engage routes (only unit coverage
   exists); consider making `wrangler` a repo devDependency instead of global.

---

## 🏗 Architecture Decisions Made
| Decision | Rationale | Date |
|----------|-----------|------|
| `network` is the platform discriminator, not a new `monitors.type` value | SQLite cannot alter a CHECK constraint, and rebuilding `monitors` would cascade-delete post_monitor_matches / ingestion_runs / alerts. A Reddit monitor is `type='recent_search'`, `network='reddit'`. | 2026-08-07 |
| Reddit posts reuse `posts.x_post_id` (as a `t3_…` fullname) | Reddit fullnames can never collide with X snowflake ids, so the global UNIQUE stays correct and the entire downstream pipeline works unchanged. | 2026-08-07 |
| Queue ranking learns by counting, not by a model | Every ordering decision stays explainable and reproducible; keeps the deterministic core / LLM edge split intact. | 2026-08-07 |
| Idempotency claim is taken *before* the X send call | At-least-once retries (queue or browser) can never double-post. Failed sends release the claim so the analyst can retry. | 2026-08-07 |
| `AUTH_MODE` declared on the pipeline worker despite no HTTP surface | `loadEnv` refuses `AUTH_MODE=development` under `APP_ENV=production`, and unset defaults to `development` — flipping APP_ENV alone would have thrown on every cron tick and killed the pipeline. | 2026-08-07 |
| Aged-out `since_id` clears the checkpoint and ACKs, without disabling the monitor | Retrying the same `since_id` can never succeed; `setMonitorRunResult`'s `COALESCE(?, since_id)` (which protects good checkpoints) meant there was no path out. Nothing is wrong with the monitor itself. | 2026-08-07 |
| Other 400s pause the monitor instead of retrying | A malformed query will not fix itself on retry either. | 2026-08-07 |

---

## 🔧 Commands to Resume
```bash
# On any machine after git pull:
git pull origin main
bash scripts/session_sync.sh --load

# In Claude Code:
# /context-health     — verify hooks are wired
# /handover           — review this file
# /token-status       — check context usage
```

Verify current state:
```bash
pnpm typecheck && pnpm test && pnpm build
```

---

## 📁 Files Modified This Session
| File | Status |
|------|--------|
| packages/engage/** | added (new package) |
| packages/reddit-client/** | added (new package) |
| packages/db/migrations/0006_nullable_run_monitor.sql | added (was untracked) |
| packages/db/migrations/0007_engagement.sql | added |
| packages/db/src/engagement.ts | added |
| packages/db/test/engagement.test.ts | added |
| packages/shared/src/crypto.ts + crypto.test.ts | added |
| packages/x-client/src/oauth.ts, write.ts, oauth.test.ts | added |
| packages/x-client/src/ratelimit.ts | modified (isStaleSinceIdError) |
| packages/db/src/repositories.ts, rows.ts, index.ts | modified |
| packages/shared/src/domain.ts, errors.ts, index.ts | modified |
| packages/config/src/env.ts | modified |
| apps/api-worker/src/engage-routes.ts | added |
| apps/api-worker/src/routes.ts, bindings.ts, wrangler.jsonc | modified |
| apps/pipeline-worker/src/pipeline.ts, index.ts, bindings.ts, wrangler.jsonc | modified |
| apps/pipeline-worker/test/wrangler-config.test.ts | added |
| apps/pipeline-worker/test/stale-checkpoint.test.ts | added |
| apps/web/src/pages/Engage.tsx, Campaigns.tsx | added |
| apps/web/src/pages/Misc.tsx, App.tsx, components/Layout.tsx, lib/types.ts | modified |
| docs/ENGAGEMENT_SETUP.md | added |
| README.md, AGENTS.md, .env.example, docs/BUILD_STATUS.md, docs/VERIFICATION.md | modified |

---

## 🌿 Git Context
```
Branch  : main
Commit  : ecce06b fix(pipeline): self-heal a since_id checkpoint that aged out of X's window
Status  : clean (only untracked context-kit artifacts: .claude/, api_docs.md, session_handover.md)
Remote  : in sync with origin/main (0 ahead, 0 behind)
```

Recent commits:
```
ecce06b fix(pipeline): self-heal a since_id checkpoint that aged out of X's window
b61437c fix(pipeline): run as production, close the open workers.dev endpoint
fe550d5 feat(engage): campaigns, AI reply drafting, pre-send safety, X sending, Reddit
d2141ca fix(db): track migration 0006 (nullable ingestion_runs.monitor_id)
672c25d feat: watchlist-driven collection, cron on/off switches (collection off by default), x.com MCP docs
```

---

## 🚀 Production State (as of 2026-08-07T12:25Z)
```
xie-api       930aaf77-c715-4a2f-ac09-b55065197f33  (100%)
xie-pipeline  e3fad789-7d56-4a0f-a166-b35730a108b7  (100%)
D1 xie-db     migrations 0006 + 0007 applied
Tests         235 passing across 15 files; typecheck clean; build clean
```

Live pipeline verified: 2 ingestion runs succeeded, 0 failed; posts 78 → 128;
screenings 23 → 27; 0 alerts. Both X monitors on a 60-minute cadence, 25 results
per run — well inside the 5000/day X and 500/day Claude budgets.

**D1 rollback point (pre-0007):**
```bash
wrangler d1 time-travel restore xie-db --bookmark=00000bad-00000000-000050c0-6c6e793cdb9b1b77427f237ade5d4274
```

**Cron switches:** `cron.collection_enabled=true`, `cron.reddit_enabled=true`
(Reddit inert until credentials + at least one Reddit monitor exist),
`cron.digest_enabled=true`, `cron.maintenance_enabled=true`.

---

## ⚠️ Critical Rules
- Never commit secrets or API keys
- Run /handover before switching devices
- Official APIs only — never scrape x.com or reddit.com
- Sending is manual and per-reply: never add an auto-post, scheduled, or bulk path
- `TOKEN_ENCRYPTION_KEY` is not recoverable from D1 — losing it means reconnecting the
  X account
- If `pnpm` or `wrangler` suddenly fail with MODULE_NOT_FOUND, the pnpm store was wiped:
  reinstall globally rather than debugging the repo

---

## 🧬 Bioinformatics Context (if applicable)
- Not configured for this project

---
_Auto-updated by `pre-compact.sh` hook and `/handover` skill._
_Read this at the start of every session. Update with `/handover`._
