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
- `pnpm test` — see verification doc (prefilter, normalization, scheduling, budget, schema, URL, MCP-input tests).

## In progress / partial

- API route integration tests against Miniflare (structure present; not exhaustive).
- Frontend component tests and full page polish.
- Alert-evaluation and digest-generation edge cases.

## Blocked (external credentials required)

- Live X collection, live Claude screening, Cloudflare deploy + D1 migrate. All are
  code-complete and documented; none are executed or claimed as executed.

## Next step

Run the verification commands in `docs/VERIFICATION.md`; provision Cloudflare per
`docs/CLOUDFLARE_SETUP.md`; add credentials to Worker secrets.
