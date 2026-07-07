# Claude Screening Setup

Structured intelligence screening uses the native Anthropic Messages API, called only
from server-side Worker code (`packages/screening/src/anthropic.ts`).

## 1. API key & model

- Set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` as Worker secrets.
- No model is hardcoded — a model id is **required** config. Recommended default:
  `claude-sonnet-4-6` for screening throughput; use a larger model for higher fidelity.

## 2. Structured output

- The screener forces tool-use (`record_screening`) with a strict JSON schema
  (`packages/screening/src/schema.ts`).
- Output is validated with Zod. On validation failure the client performs **one repair
  retry** with the specific issues, then rejects — malformed output never reaches the DB.

## 3. Prompt versioning

- Prompts are centralized and versioned: `x-intel-screen-v1`, `x-intel-digest-v1`
  (`packages/config/src/scoring.ts`, `packages/screening/src/prompt.ts`).
- Every screening row stores `model` + `prompt_version`. Rescreening with a new
  model/prompt creates a new row and preserves history (spec §56/§57).

## 4. Prompt-injection defense

- Post content is **untrusted**. The system prompt states this explicitly; the untrusted
  post text is passed in a fenced, clearly-labelled user block, never concatenated into
  the system instruction. Links are not fetched during screening.

## 5. Budgets

- `CLAUDE_DAILY_REQUEST_BUDGET` is enforced before each call. Costs are estimated from
  `CLAUDE_INPUT_COST_PER_MILLION` / `CLAUDE_OUTPUT_COST_PER_MILLION` and labelled estimates.

## 6. Rescreen

- `POST /api/posts/:id/rescreen` enqueues a forced re-screen job processed by the
  pipeline worker.

## 7. Troubleshooting

- **CONFIGURATION_ERROR: Claude screening not configured** — missing key/model.
- **RATE_LIMIT_ERROR** — 429 from Anthropic; the queue retries with backoff.
- **CLAUDE_API_ERROR: invalid screening output** — model returned non-conforming data
  twice; inspect the post and prompt version.
