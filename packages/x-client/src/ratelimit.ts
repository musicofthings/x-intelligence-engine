/** X rate-limit header parsing + backoff (spec §7.6). Pure + unit-tested. */

/**
 * True when X rejected the request because the stored `since_id` checkpoint has aged
 * out of the recent-search window (X only serves the last 7 days).
 *
 * This arrives as a 400, which is otherwise a permanent client error — but this
 * particular one is self-healing: clear the checkpoint and the next run succeeds.
 * Distinguishing it matters because retrying with the same `since_id` can never work,
 * so treating it as transient means failing every run forever.
 */
export function isStaleSinceIdError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 || !body) return false;
  return /since_id/i.test(body) && /must be a tweet id created after|larger than/i.test(body);
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** Epoch seconds when the window resets. */
  resetAt: number | null;
}

export function parseRateLimit(headers: Headers): RateLimitInfo {
  const num = (k: string): number | null => {
    const v = headers.get(k);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    limit: num("x-rate-limit-limit"),
    remaining: num("x-rate-limit-remaining"),
    resetAt: num("x-rate-limit-reset"),
  };
}

/**
 * Exponential backoff with full jitter (spec §7.6). Deterministic when a `rand`
 * function is injected (tests pass rand=()=>0 for the floor, ()=>1 for the ceiling).
 * On 429 with a reset header, waits until reset instead.
 */
export function backoffMs(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number; rand?: () => number } = {},
): number {
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 60_000;
  const rand = opts.rand ?? Math.random;
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.floor(exp * rand());
}

export function retryAfterFromReset(resetAt: number | null, nowSeconds: number): number | null {
  if (resetAt === null) return null;
  const delta = resetAt - nowSeconds;
  return delta > 0 ? delta * 1000 : 0;
}

export function shouldRetry(status: number, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) return false;
  return status === 429 || (status >= 500 && status < 600);
}
