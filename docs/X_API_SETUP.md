# X (Twitter) API Setup

This app uses the **official X API v2 only**. It never scrapes x.com, never uses
undocumented/reverse-engineered endpoints, cookies, or headless-login automation.

## 1. Developer project & app

1. Create a project + app in the X developer portal.
2. Ensure your access tier includes the endpoints you need. Entitlements differ by tier
   — the app detects capabilities and degrades gracefully.

## 2. Authentication

- App-only **Bearer token** is used for read endpoints. Put it in the `X_BEARER_TOKEN`
  secret (never in the frontend or `.env.example`).
- Base URL is configurable via `X_API_BASE_URL` (default `https://api.x.com`).

## 3. Endpoints used

| Capability | Endpoint | Monitor type |
|---|---|---|
| Recent search | `GET /2/tweets/search/recent` | `recent_search` |
| User timeline | `GET /2/users/{id}/tweets` | `user_watchlist` |
| List timeline | `GET /2/lists/{id}/tweets` | `x_list` |
| Post lookup | `GET /2/tweets/{id}` | (explicit only) |
| User lookup | `GET /2/users/by/username/{username}` | handle → id resolution |

Fields requested are intentionally lean (`packages/x-client/src/types.ts`): id, text,
author_id, created_at, conversation_id, lang, public_metrics, referenced_tweets,
in_reply_to_user_id + author expansion.

## 4. Recent search / watchlist / list

- Checkpoints via `since_id` avoid re-reading ingested posts.
- Per-run result and pagination caps are set per monitor.
- Starter monitors are seeded **disabled**; validate each query against currently
  supported X operators before enabling (the app validates structure, not live X).

## 5. Filtered Stream webhooks

- Endpoint: `GET/POST /api/webhooks/x`. GET answers the CRC challenge; POST verifies the
  HMAC-SHA256 signature (constant-time) before enqueueing.
- ⚠️ The exact header name / challenge format evolve — **confirm against current official
  X docs** before enabling in production (`packages/x-client/src/webhook.ts` notes this).
- If your tier lacks streaming, the app stays fully functional on scheduled polling.

## 6. Rate limits

The client parses `x-rate-limit-*` headers; the pipeline applies 429/5xx retry with
exponential backoff + jitter and records failures. Monitors can be paused on repeated
failures.

## 7. Cost awareness

Reads cost money on paid tiers. Budgets (`X_DAILY_RESOURCE_BUDGET`,
`X_MONTHLY_RESOURCE_BUDGET`, `HARD_STOP_ON_BUDGET_EXCEEDED`) are enforced **before** every
live call. "Run now" is explicit and cost-warned in the UI.

## 8. Troubleshooting

- **401** — bad/expired bearer token; re-check the `X_BEARER_TOKEN` secret.
- **403** — endpoint not entitled for your tier, or query uses an unavailable operator.
- **429** — rate limited; the app backs off. Reduce `poll_interval` / `max_results`.
