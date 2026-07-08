# Production Go-Live Runbook

Takes the app from "public on workers.dev with dev auth" to a locked-down production
deployment behind Cloudflare Access. Replace `seyarkainunnarivu.com` / `app.seyarkainunnarivu.com` with your
real domain. Order matters.

## Topology (single origin — recommended)

Everything on **one hostname** `app.seyarkainunnarivu.com`, so the SPA calls the API same-origin
(no CORS) and one Access session covers both:

```
app.seyarkainunnarivu.com/mcp    -> api-worker  (Access: BYPASS — worker's Bearer token guards it)
app.seyarkainunnarivu.com/api/*  -> api-worker  (Access: ALLOW  — verified Access JWT)
app.seyarkainunnarivu.com/*      -> Pages (SPA) (Access: ALLOW)
```

Worker routes take precedence over Pages for matching paths, so `/api/*` and `/mcp` hit
the worker and everything else serves the SPA.

## Phase 1 — Add your domain to Cloudflare

1. Cloudflare dashboard → **Add a site** → enter `seyarkainunnarivu.com` → Free plan.
2. Cloudflare shows two nameservers. At your **registrar**, replace the domain's
   nameservers with those two.
3. Wait until the zone shows **Active** (minutes–hours). Confirm with `nslookup -type=ns seyarkainunnarivu.com`.

## Phase 2 — Custom domain + routes

1. **Pages**: Workers & Pages → `xie-web` → **Custom domains** → add `app.seyarkainunnarivu.com`.
2. **API worker routes**: in `apps/api-worker/wrangler.jsonc`, add routes and disable the
   workers.dev URL (defense in depth — the worker is then only reachable on your domain):

   ```jsonc
   "workers_dev": false,
   "routes": [
     { "pattern": "app.seyarkainunnarivu.com/api/*", "zone_name": "seyarkainunnarivu.com" },
     { "pattern": "app.seyarkainunnarivu.com/mcp",   "zone_name": "seyarkainunnarivu.com" }
   ],
   ```
3. **Production vars** in the same file:
   ```jsonc
   "APP_ENV": "production",
   "AUTH_MODE": "cloudflare_access",
   "WEB_ORIGIN": "https://app.seyarkainunnarivu.com",
   ```
4. **Frontend base URL** — same origin now. Set `apps/web/.env.production`:
   ```
   VITE_API_BASE_URL=/api
   ```

## Phase 3 — Cloudflare Access (Zero Trust)

Zero Trust dashboard → **Access → Applications**:

1. **App A (MCP bypass)** — Self-hosted, domain `app.seyarkainunnarivu.com`, **path `/mcp`**.
   Policy: **Bypass**, Everyone. (Claude Code can't do interactive SSO; the worker's
   `MCP_API_TOKEN` Bearer check secures this path.)
2. **App B (main)** — Self-hosted, domain `app.seyarkainunnarivu.com` (path blank).
   Policy: **Allow**, Include → Emails → your analyst list.
   From App B **Overview**, copy the **Application Audience (AUD) Tag**.
3. Team domain: Zero Trust → **Settings → Custom Pages** shows `yourteam.cloudflareaccess.com`.

Access evaluates the more specific path first, so `/mcp` bypass wins for MCP while the
rest requires SSO.

## Phase 4 — Secrets (both workers)

```powershell
# api-worker — Access identity for JWT verification
wrangler secret put CF_ACCESS_TEAM_DOMAIN --config apps/api-worker/wrangler.jsonc   # yourteam.cloudflareaccess.com
wrangler secret put CF_ACCESS_AUD         --config apps/api-worker/wrangler.jsonc   # App B AUD tag
wrangler secret put ALLOWED_EMAILS        --config apps/api-worker/wrangler.jsonc   # comma-separated
wrangler secret put MCP_API_TOKEN         --config apps/api-worker/wrangler.jsonc
wrangler secret put X_BEARER_TOKEN        --config apps/api-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_API_KEY     --config apps/api-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_MODEL       --config apps/api-worker/wrangler.jsonc   # verify id is current
wrangler secret put X_WEBHOOK_SECRET      --config apps/api-worker/wrangler.jsonc   # only if using webhooks

# pipeline-worker — it actually calls X + Claude
wrangler secret put X_BEARER_TOKEN    --config apps/pipeline-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_API_KEY --config apps/pipeline-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_MODEL   --config apps/pipeline-worker/wrangler.jsonc
wrangler secret put ALERT_WEBHOOK_URL --config apps/pipeline-worker/wrangler.jsonc  # optional
```

The pipeline worker has no public HTTP routes (cron + queue only), so it needs no Access.

## Phase 5 — Deploy everything

```powershell
# queues + remote migrations (if not already done)
wrangler queues list
pnpm db:migrate:remote

# workers
pnpm deploy:api
pnpm deploy:pipeline

# frontend
pnpm --filter @xie/web build
wrangler pages deploy apps/web/dist --project-name xie-web
```

## Phase 6 — Verify

1. Open `https://app.seyarkainunnarivu.com` → Cloudflare Access login → your email → dashboard loads.
2. `GET https://app.seyarkainunnarivu.com/api/health` (in-browser, authenticated) → `status: ok`.
3. Hitting the API without an Access session (e.g. curl, no cookie) → **401/403**. Good.
4. `wrangler tail xie-pipeline` — watch cron ticks.
5. MCP: `claude mcp add --transport http xie https://app.seyarkainunnarivu.com/mcp --header "Authorization: Bearer <MCP_API_TOKEN>"`.

## Phase 7 — Go live (start spending)

1. In the dashboard, **enable** one monitor, click **Run now**, watch `wrangler tail xie-pipeline`.
2. Confirm posts appear in the feed and screening/alerts populate.
3. Set budgets to taste (`X_DAILY_RESOURCE_BUDGET`, `CLAUDE_DAILY_REQUEST_BUDGET`,
   `HARD_STOP_ON_BUDGET_EXCEEDED=true`) before enabling more monitors.

## Rollback

Set `AUTH_MODE=development` + `APP_ENV=development` is **refused** in production by design.
To roll back, redeploy the previous worker version (`wrangler rollback --config …`) or
disable all monitors from the dashboard to stop spend immediately.

## Security invariants (already enforced in code)

- The worker cryptographically verifies the Access JWT (signature + AUD + expiry + issuer
  + email allow-list) — it does not trust the email header alone.
- `workers_dev: false` removes the unauthenticated direct URL.
- `/mcp` uses a separate constant-time Bearer check, not Access.
- Secrets never reach the browser; X content is rendered as plain text.
