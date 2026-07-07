# Cloudflare Setup

Exact provisioning steps. Replace `<PLACEHOLDER>` values with real ids — no fictional
ids are included. Run from the repo root unless noted.

## 0. Prerequisites

```powershell
npm install -g wrangler   # or use `pnpm dlx wrangler ...`
wrangler --version
```

## 1. Authenticate Wrangler

```powershell
wrangler login
```

## 2. Create the D1 database

```powershell
wrangler d1 create xie-db
```

Copy the printed `database_id` into **both** worker configs:
- `apps/api-worker/wrangler.jsonc` → `d1_databases[0].database_id`
- `apps/pipeline-worker/wrangler.jsonc` → `d1_databases[0].database_id`

## 3. Create queues (+ dead-letter queues)

```powershell
wrangler queues create x-ingest-queue
wrangler queues create x-screening-queue
wrangler queues create x-ingest-dlq
wrangler queues create x-screening-dlq
```

## 4. (Optional) R2 bucket and Vectorize index

Only if you enable the flags (`ENABLE_RAW_ARCHIVE`, `ENABLE_VECTOR_SEARCH`).

```powershell
wrangler r2 bucket create xie-raw-archive
wrangler vectorize create xie-post-vectors --dimensions=1024 --metric=cosine
```

Then add the `r2_buckets` / `vectorize` bindings to the worker configs.

## 5. Apply migrations

```powershell
# local (uses .wrangler state)
wrangler d1 migrations apply xie-db --local --config apps/api-worker/wrangler.jsonc
# remote (production)
wrangler d1 migrations apply xie-db --remote --config apps/api-worker/wrangler.jsonc
```

Migrations live in `packages/db/migrations` (referenced by `migrations_dir`).

## 6. Set Worker secrets

Set on **each** worker (`--config apps/<worker>/wrangler.jsonc`). Never commit these.

```powershell
wrangler secret put X_BEARER_TOKEN        --config apps/api-worker/wrangler.jsonc
wrangler secret put X_WEBHOOK_SECRET      --config apps/api-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_API_KEY     --config apps/api-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_MODEL       --config apps/api-worker/wrangler.jsonc
wrangler secret put MCP_API_TOKEN         --config apps/api-worker/wrangler.jsonc
wrangler secret put CF_ACCESS_TEAM_DOMAIN --config apps/api-worker/wrangler.jsonc
wrangler secret put CF_ACCESS_AUD         --config apps/api-worker/wrangler.jsonc
wrangler secret put ALLOWED_EMAILS        --config apps/api-worker/wrangler.jsonc

# pipeline worker
wrangler secret put X_BEARER_TOKEN    --config apps/pipeline-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_API_KEY --config apps/pipeline-worker/wrangler.jsonc
wrangler secret put ANTHROPIC_MODEL   --config apps/pipeline-worker/wrangler.jsonc
wrangler secret put ALERT_WEBHOOK_URL --config apps/pipeline-worker/wrangler.jsonc
```

Also set `APP_ENV=production` and `AUTH_MODE=cloudflare_access` in the `vars` block
before a production deploy (the app refuses dev auth in production).

## 7. Deploy workers

```powershell
pnpm deploy:api
pnpm deploy:pipeline
```

## 8. Deploy the frontend (Pages)

```powershell
pnpm --filter @xie/web build
wrangler pages deploy apps/web/dist --project-name xie-web
```

Set the Pages env var `VITE_API_BASE_URL` to the API worker URL (or route `/api` to it).

## 9. Custom domains

Bind a route/custom domain to `xie-api` and a Pages custom domain to `xie-web` in the
Cloudflare dashboard.

## 10. Cloudflare Access

Protect the Pages app and the API worker with Access. Capture the **Application Audience
(AUD)** tag and your team domain into `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN`, and set
`ALLOWED_EMAILS` to the analyst allow-list.

## 11. Verify cron + health

```powershell
wrangler tail xie-pipeline           # watch scheduled + queue logs
curl https://<api-domain>/api/health # lightweight, unauthenticated
```

## 12. Configure the X webhook callback

Register `https://<api-domain>/api/webhooks/x` in the X developer portal (see
`docs/X_API_SETUP.md`). Only enable after confirming the current signature protocol.
