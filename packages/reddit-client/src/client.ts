import { AppError } from "@xie/shared";
import type { RedditListing, RedditTokenResponse } from "./types.js";

/**
 * Official Reddit API client (OAuth2 application-only). Native fetch only, no
 * scraping, no undocumented endpoints. Credentials stay server-side.
 *
 * Reddit requires a descriptive User-Agent; requests without one are throttled hard.
 */

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

export interface RedditClientConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. "xie/1.0 (by /u/yourhandle)" — required by Reddit's API rules. */
  userAgent: string;
  baseUrl?: string;
  tokenUrl?: string;
}

export interface RedditRateLimit {
  remaining: number | null;
  used: number | null;
  resetSeconds: number | null;
}

export interface RedditResult<T> {
  data: T;
  rateLimit: RedditRateLimit;
}

export interface RedditSearchParams {
  /** Search terms. Ignored by `subredditNew`. */
  query?: string;
  /** Restrict to these subreddits. Empty = site-wide search. */
  subreddits?: string[];
  limit?: number;
  sort?: "new" | "relevance" | "hot" | "top" | "comments";
  /** Reddit's cursor — the `after` fullname from the previous listing. */
  after?: string;
  /** Time window for relevance/top sorts. */
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
}

export class RedditClient {
  private readonly cfg: RedditClientConfig;
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(cfg: RedditClientConfig, fetchImpl: typeof fetch = fetch) {
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new AppError("CONFIGURATION_ERROR", "Reddit API not configured");
    }
    if (!cfg.userAgent) {
      throw new AppError("CONFIGURATION_ERROR", "Reddit API requires a REDDIT_USER_AGENT");
    }
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
  }

  /** Application-only token. Cached in-memory for the life of the isolate. */
  private async accessToken(nowMs: number): Promise<string> {
    if (this.token && this.token.expiresAtMs > nowMs + 60_000) return this.token.value;

    const doFetch = this.fetchImpl;
    const basic = base64(`${this.cfg.clientId}:${this.cfg.clientSecret}`);
    const res = await doFetch(this.cfg.tokenUrl ?? TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": this.cfg.userAgent,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new AppError(res.status === 401 ? "AUTHENTICATION_ERROR" : "REDDIT_API_ERROR", "Reddit token request failed", {
        detail: { status: res.status, body: await safeText(res) },
      });
    }
    const body = (await res.json()) as RedditTokenResponse;
    if (!body.access_token) {
      throw new AppError("AUTHENTICATION_ERROR", "Reddit returned no access token");
    }
    this.token = {
      value: body.access_token,
      expiresAtMs: nowMs + Math.max(60, body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  private async get<T>(path: string, query: Record<string, string | number | undefined>, nowMs: number): Promise<RedditResult<T>> {
    const token = await this.accessToken(nowMs);
    const url = new URL(`${(this.cfg.baseUrl ?? API_BASE).replace(/\/+$/, "")}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    // Detached local: the runtime's global fetch throws if invoked as a method.
    const doFetch = this.fetchImpl;
    const res = await doFetch(url.toString(), {
      headers: { authorization: `Bearer ${token}`, "user-agent": this.cfg.userAgent },
    });
    const rateLimit = parseRedditRateLimit(res.headers);
    if (!res.ok) {
      // A 401 here means the cached token went stale; drop it so the next call re-auths.
      if (res.status === 401) this.token = null;
      const code =
        res.status === 401 ? "AUTHENTICATION_ERROR"
          : res.status === 403 ? "AUTHORIZATION_ERROR"
            : res.status === 429 ? "RATE_LIMIT_ERROR"
              : "REDDIT_API_ERROR";
      throw new AppError(code, "Reddit API request failed", {
        detail: { status: res.status, body: await safeText(res), path },
      });
    }
    return { data: (await res.json()) as T, rateLimit };
  }

  /** GET /search or /r/{subs}/search — keyword search, optionally subreddit-restricted. */
  search(params: RedditSearchParams, nowMs: number = Date.now()): Promise<RedditResult<RedditListing>> {
    const subs = (params.subreddits ?? []).map(cleanSubreddit).filter(Boolean);
    const path = subs.length ? `/r/${subs.join("+")}/search` : "/search";
    return this.get<RedditListing>(path, {
      q: params.query ?? "",
      limit: clampLimit(params.limit),
      sort: params.sort ?? "new",
      t: params.time ?? "week",
      after: params.after,
      restrict_sr: subs.length ? "1" : undefined,
      type: "link",
      include_over_18: "off",
      raw_json: 1,
    }, nowMs);
  }

  /** GET /r/{subs}/new — everything new in the given subreddits, no query. */
  subredditNew(subreddits: string[], params: Omit<RedditSearchParams, "subreddits" | "query"> = {}, nowMs: number = Date.now()): Promise<RedditResult<RedditListing>> {
    const subs = subreddits.map(cleanSubreddit).filter(Boolean);
    if (!subs.length) {
      throw new AppError("VALIDATION_ERROR", "At least one subreddit is required");
    }
    return this.get<RedditListing>(`/r/${subs.join("+")}/new`, {
      limit: clampLimit(params.limit),
      after: params.after,
      raw_json: 1,
    }, nowMs);
  }

  /** GET /r/{sub}/about — used to validate a subreddit during campaign setup. */
  subredditAbout(subreddit: string, nowMs: number = Date.now()): Promise<RedditResult<{ data?: { display_name?: string; subscribers?: number; public_description?: string; over18?: boolean } }>> {
    return this.get(`/r/${cleanSubreddit(subreddit)}/about`, { raw_json: 1 }, nowMs);
  }
}

/** Strip `r/`, `/r/`, whitespace and anything not legal in a subreddit name. */
export function cleanSubreddit(s: string): string {
  return s.trim().replace(/^\/?r\//i, "").replace(/[^A-Za-z0-9_]/g, "");
}

export function parseRedditRateLimit(headers: Headers): RedditRateLimit {
  const num = (k: string): number | null => {
    const v = headers.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    remaining: num("x-ratelimit-remaining"),
    used: num("x-ratelimit-used"),
    resetSeconds: num("x-ratelimit-reset"),
  };
}

function clampLimit(n: number | undefined): number {
  const v = n ?? 25;
  return Math.max(1, Math.min(100, Math.trunc(v)));
}

function base64(s: string): string {
  // Workers and Node both expose btoa; avoid Buffer so this stays edge-compatible.
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
