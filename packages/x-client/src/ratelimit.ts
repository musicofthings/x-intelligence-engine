/** X rate-limit header parsing + backoff (spec §7.6). Pure + unit-tested. */

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
