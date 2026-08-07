# Build Status

_Last updated: 2026-07-07_

This file is kept honest: it reflects what is actually implemented and verified, not
what is planned. See `docs/IMPLEMENTATION_PLAN.md` for the full roadmap.

## Completed

- Monorepo scaffold: pnpm workspace, shared tsconfig, root scripts, `.env.example`, `.gitignore`.
- `packages/shared`: canonical domain types (§61), typed error taxonomy (§34), structured logger (§35), string-safe ID helpers, post-URL builder (§52).
- `packages/config`: env parsing (Zod), pricing/budget/scoring config, prompt version constants, score bands.
- `packages/screening`: deterministic versioned prefilter (§13) with factor-level reasons; Claude screening prompt `x-intel-screen-v1` (§16) with injection defenses; screening output Zod schema (§15); Anthropic client with strict validation + one repair retry.
- `packages/x-client`: official X API client (recent search, user timeline, list timeline, post/user lookup), normalization to `NormalizedXPost`, rate-limit header parsing + backoff.
- `packages/db`: full D1 migration set (all §10 tables + §11 indexes), seed migration (starter monitors disabled, default settings), repository layer.
- `packages/mcp`: read-only MCP tools over repositories.
- `apps/api-worker`: Hono app with auth/CORS/security-header middleware, error envelope, and route modules.
- `apps/pipeline-worker`: scheduled dispatcher + queue consumers + digest/maintenance.
- `apps/web`: Vite React scaffold with routing, theme, API client, and pages.
- Docs: setup guides, CI workflow.

## Verified (commands actually run)

See `docs/VERIFICATION.md` for the command log. Summary:

- `pnpm install` — see verification doc.
- `pnpm typecheck` — see verification doc.
- `pnpm test` — 101 tests across 8 files (see verification doc).

## Deployed to production

- Single-origin architecture: the api-worker serves the API, `/mcp`, and the built SPA
  (Workers Static Assets) on `app.seyarkainunnarivu.com`, behind Cloudflare Access with
  a cryptographically-verified Access JWT (RS256 sig + aud + expiry + email allow-list).
- pipeline-worker deployed (cron dispatcher + queue consumers); D1 + queues provisioned;
  migrations applied. Live X → prefilter → Claude → feed confirmed working.

## Added post-v1 (this session)

- Cloudflare Access JWT verification in the worker (defense-in-depth).
- Admin: Log out, Clear cache, and audited DB maintenance (reset runs/alerts/usage/digests,
  purge old posts with starred-protection, full data reset preserving config).
- Watchlists: full CRUD + account add/remove (migration none needed).
- Manual alerts: analyst-created standalone alerts (migration `0004_manual_alerts`).
- Pipeline hardening: unbound-fetch fix, upstream-status logging, auto-pause on permanent
  X errors (401/402/403).

## Engagement layer + Reddit (2026-08-07)

Migration `0007_engagement`. Everything below is implemented, typechecked, and covered by
tests; see `docs/ENGAGEMENT_SETUP.md` for the credentials each part needs.

- `packages/engage`: pure, versioned queue ranking (`engage-rank-v1`) and pre-send safety
  checks (`engage-safety-v1`); Claude reply drafting `x-intel-reply-v1` with forced tool
  use, strict validation, one repair retry, and the same injection defenses as screening.
- `packages/reddit-client`: official Reddit API (application-only OAuth), keyword search,
  subreddit firehose, subreddit lookup, normalization onto `NormalizedXPost`.
- `packages/x-client`: OAuth 2.0 Authorization Code + PKCE (authorize / exchange / refresh
  / revoke) and `XWriteClient.replyTo` under user context.
- `packages/shared`: AES-256-GCM secret envelope + PKCE helpers; `Network` and the
  engagement domain types.
- `packages/db`: `EngagementRepo` (campaigns, voice profiles, drafts, sends, sessions,
  events, learned signals, OAuth token + PKCE state) exposed as `repo.engage`.
- `apps/api-worker`: `src/engage-routes.ts` — campaigns, voice profiles, engage queue,
  drafting + transforms, safety check, send, sessions/goals/stats, X OAuth connect flow,
  Reddit validate/preview.
- `apps/pipeline-worker`: Reddit dispatcher + collector behind its own `cron.reddit_enabled`
  switch (independent of X collection, both default OFF); OAuth-state purge in maintenance.
- `apps/web`: Engage, Campaigns (+ voice profiles), Engagement (session stats) pages;
  Connected accounts panel in Settings.

**Verified:** `pnpm -r typecheck` clean across 11 workspaces; `pnpm -r test` 216 tests
passing across 13 files; `pnpm --filter @xie/web build` clean.

**Not yet exercised against live upstreams.** The X OAuth consent flow, an actual reply
POST, and live Reddit collection have not been run — they need real credentials
(`X_OAUTH_CLIENT_ID`, `TOKEN_ENCRYPTION_KEY`, `REDDIT_*`), a write-enabled X tier, and the
callback URL registered on the X app. All three paths are unit-tested against stubbed
fetch, not against the real services.

## Remaining (non-blocking)

- API route integration tests against Miniflare (unit + acceptance coverage present).
- Live smoke test of the OAuth connect → draft → send round trip once credentials exist.
- Frontend component tests; watchlist-driven collection wiring (accounts → user-timeline monitors).
- Confirm `ANTHROPIC_MODEL` id is current in the deployed secret.
