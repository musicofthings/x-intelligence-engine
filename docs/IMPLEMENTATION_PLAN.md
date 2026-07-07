# Implementation Plan — X Intelligence Engine

Status legend: ✅ done & verified · 🟡 in progress · ⬜ not started

## Guiding decisions (resolved from spec defaults)

- **Monorepo**: pnpm workspaces, TypeScript strict, `tsconfig.base.json` shared.
- **Router**: Hono on Workers. **Validation**: Zod everywhere at boundaries.
- **DB access**: hand-written typed repositories over `D1PreparedStatement` (Drizzle
  avoided to keep the Workers bundle lean and D1 semantics explicit). SQL lives only
  in `packages/db`.
- **Frontend**: React 18 + Vite + React Router + TanStack Query + Tailwind. Desktop-first,
  dark/light, accessible. No X-clone styling.
- **Screening**: native Anthropic Messages API via `fetch` (Workers-compatible), tool
  use / JSON-schema forced output, strict Zod validation with one repair retry.
- **MCP**: JSON-RPC 2.0 over HTTP at `/mcp`, bearer auth, read-only by default.
- **Timezone**: `Asia/Kolkata` default; cron scheduled in UTC with conversion.
- **Auth**: Cloudflare Access JWT verification in production; `AUTH_MODE=development`
  bypass allowed only when `APP_ENV !== production` (hard refusal otherwise).

## Build order & status

### Phase 1 — Foundation
- ✅ Repo inspection, AGENTS.md, this plan, BUILD_STATUS.md
- ✅ Root config: pnpm-workspace, package.json, tsconfig.base, .gitignore, .env.example
- ✅ `packages/shared`: domain types, error taxonomy, structured logger, ID helpers
- ✅ `packages/config`: env schema, settings/pricing/budgets, prompt versions

### Phase 2 — Data layer
- ✅ D1 migrations (all tables from spec §10, indexes §11)
- 🟡 `packages/db`: repository layer (posts, monitors, screening, usage, alerts, digests, runs, webhooks)
- ⬜ Repository integration tests against better-sqlite3 in-memory

### Phase 3 — X client
- ✅ `packages/x-client`: recent search, user timeline, list timeline, post lookup, user lookup
- ✅ Normalization to `NormalizedXPost`, string-safe IDs, rate-limit parsing
- ✅ Unit tests: normalization, ID handling, rate-limit backoff

### Phase 4 — Pipeline logic
- ✅ `packages/screening` deterministic prefilter (versioned, factor reasons)
- ✅ Prefilter + threshold + scheduling + budget unit tests
- 🟡 Queue message schemas, idempotent consumers (pipeline-worker)
- 🟡 Usage accounting

### Phase 5 — Claude screening
- ✅ Prompt (`x-intel-screen-v1`) with injection defenses, output Zod schema
- ✅ Anthropic client + validation/repair; schema-validation tests
- 🟡 Alert evaluation logic + tests

### Phase 6 — API Worker
- 🟡 Hono app, auth middleware, CORS, security headers, error envelope
- 🟡 Routes: health, dashboard, posts, monitors, watchlists, rules, alerts, digests, sources, usage, settings, system, webhook
- ⬜ Route integration tests (workers-pool / miniflare)

### Phase 7 — Web app
- 🟡 Vite scaffold, routing, query client, theme, layout
- 🟡 Pages: dashboard, feed, detail, monitors, watchlists, rules, alerts, digests, sources, usage, settings, system
- ⬜ Component tests

### Phase 8 — MCP
- ✅ `packages/mcp` tool definitions + handlers over repositories (read-only default)
- 🟡 `/mcp` endpoint wiring in api-worker, bearer auth
- ⬜ MCP auth/input-validation tests

### Phase 9 — Cron & jobs
- 🟡 Collection dispatcher (due-monitor calc), digest cron, maintenance cron

### Phase 10 — Quality
- 🟡 CI workflow, lint/typecheck/test/build gates
- ⬜ Security pass

### Phase 11 — Deploy
- ⬜ Cloudflare provisioning (needs account + credentials — documented, not executed)

## Known blockers (need human credentials)
- Cloudflare account id, D1 database id, API token → cannot run Wrangler deploy/migrate.
- X developer bearer token → cannot run live collection or validate queries against X.
- Anthropic API key → cannot run live screening.

All of the above are handled with `.env.example`, capability detection, and exact
provisioning commands in `docs/CLOUDFLARE_SETUP.md`. No deployment is claimed as
performed until it actually is.
