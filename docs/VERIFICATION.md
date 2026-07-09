# Verification Log

Commands actually run in the build environment (Windows 10, Node v24.13.0, pnpm 11.9.0)
and their real outcomes. No results are fabricated.

## Environment note

- `better-sqlite3` (native) does not compile here (no MSVC toolchain; Node 24 ABI).
  The DB integration tests instead use Node's built-in `node:sqlite` as a D1 adapter —
  zero native build required. This affects **tests only**; production uses Cloudflare D1.

## Results

| Command | Result | Notes |
|---|---|---|
| `pnpm install` | ✅ success | 9 workspaces; esbuild build approved |
| `pnpm typecheck` | ✅ success | all 9 workspaces `tsc --noEmit` clean |
| `pnpm test` | ✅ success | 101 tests across 8 files, all passing |
| `pnpm --filter @xie/web build` | ✅ success | `dist/` produced, ~277 kB (87 kB gzip) |
| `pnpm --filter @xie/api-worker build` | ✅ success | typecheck build |
| `pnpm --filter @xie/pipeline-worker build` | ✅ success | typecheck build |

### Test breakdown (101 total)

- `@xie/shared` — 12 (ids as strings, URL builder, SSRF guard, error envelope)
- `@xie/config` — 17 (env boot/capability gaps, prod auth refusal, budgets, bands, scheduling, pricing)
- `@xie/x-client` — 15 (normalization, string ids, rate-limit parse/backoff, webhook HMAC verify, client guards)
- `@xie/screening` — 16 (deterministic prefilter, schema validation, alert eval, injection separation, mocked Anthropic)
- `@xie/db` — 16 (migrations+seed, idempotency, usage aggregation, feed cursor, watchlist CRUD, manual alerts, maintenance incl. starred-purge protection)
- `@xie/mcp` — 7 (read-only default, input validation, unknown tool, untrusted labelling, no secrets)
- `@xie/api-worker` — 8 (Cloudflare Access JWT: RS256 signature, forged-token/expiry/aud/allow-list/issuer/kid rejection)
- `@xie/pipeline-worker` — 2 (full acceptance flow §66 with mocked X + Claude; screening idempotency under duplicate delivery)

### Production deployment (performed by operator)

- Deployed to Cloudflare: api-worker (serves API + MCP + SPA via Static Assets) on `app.seyarkainunnarivu.com` behind Cloudflare Access (One-time PIN), pipeline-worker (cron + queue consumers), D1 + queues provisioned, migrations applied.
- Live X collection → prefilter → Claude screening → feed confirmed working end to end.

## Not verified here (needs external credentials / Cloudflare)

- `pnpm lint` — no ESLint config wired yet (CI step present; add `eslint.config.js` to activate).
- Live X collection, live Claude screening — need `X_BEARER_TOKEN`, `ANTHROPIC_API_KEY`.
- `wrangler deploy` / `d1 migrations apply --remote` — need Cloudflare account + `D1_DATABASE_ID`.
- Miniflare route integration tests — structure present; not run in this environment.

None of the above are claimed as done. See `docs/CLOUDFLARE_SETUP.md` for exact commands.
