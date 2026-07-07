import { AppError } from "@xie/shared";
import {
  TWEET_FIELDS,
  USER_FIELDS,
  EXPANSIONS,
  type XSearchResponse,
  type XUser,
} from "./types.js";
import { parseRateLimit, type RateLimitInfo } from "./ratelimit.js";

/**
 * Official X API v2 client (spec §7). Native fetch only. NEVER scrapes x.com,
 * NEVER uses undocumented endpoints. Credentials stay server-side.
 */

export interface XClientConfig {
  bearerToken: string;
  baseUrl?: string;
}

export interface XResult<T> {
  data: T;
  rateLimit: RateLimitInfo;
}

export interface RecentSearchParams {
  query: string;
  maxResults?: number; // 10..100
  sinceId?: string;
  startTime?: string;
  endTime?: string;
  paginationToken?: string;
}

export interface TimelineParams {
  maxResults?: number;
  sinceId?: string;
  paginationToken?: string;
  excludeReplies?: boolean;
  excludeRetweets?: boolean;
}

export class XClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: XClientConfig, fetchImpl: typeof fetch = fetch) {
    if (!cfg.bearerToken) {
      throw new AppError("CONFIGURATION_ERROR", "X API not configured");
    }
    this.token = cfg.bearerToken;
    this.base = (cfg.baseUrl ?? "https://api.x.com").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  private async get<T>(path: string, query: Record<string, string | number | undefined>): Promise<XResult<T>> {
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await this.fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
    });
    const rateLimit = parseRateLimit(res.headers);
    if (!res.ok) {
      const code =
        res.status === 401
          ? "AUTHENTICATION_ERROR"
          : res.status === 403
            ? "AUTHORIZATION_ERROR"
            : res.status === 429
              ? "RATE_LIMIT_ERROR"
              : "X_API_ERROR";
      const body = await safeText(res);
      throw new AppError(code, "X API request failed", {
        detail: { status: res.status, body, path },
      });
    }
    const data = (await res.json()) as T;
    return { data, rateLimit };
  }

  /** GET /2/tweets/search/recent (spec §7.1). */
  recentSearch(params: RecentSearchParams): Promise<XResult<XSearchResponse>> {
    return this.get<XSearchResponse>("/2/tweets/search/recent", {
      query: params.query,
      max_results: clampResults(params.maxResults),
      since_id: params.sinceId,
      start_time: params.startTime,
      end_time: params.endTime,
      pagination_token: params.paginationToken,
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
    });
  }

  /** GET /2/users/{id}/tweets (spec §7.2). */
  userTimeline(userId: string, params: TimelineParams = {}): Promise<XResult<XSearchResponse>> {
    const exclude: string[] = [];
    if (params.excludeReplies) exclude.push("replies");
    if (params.excludeRetweets) exclude.push("retweets");
    return this.get<XSearchResponse>(`/2/users/${encodeURIComponent(userId)}/tweets`, {
      max_results: clampResults(params.maxResults),
      since_id: params.sinceId,
      pagination_token: params.paginationToken,
      exclude: exclude.length ? exclude.join(",") : undefined,
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
    });
  }

  /** GET /2/lists/{id}/tweets (spec §7.3). */
  listTimeline(listId: string, params: TimelineParams = {}): Promise<XResult<XSearchResponse>> {
    return this.get<XSearchResponse>(`/2/lists/${encodeURIComponent(listId)}/tweets`, {
      max_results: clampResults(params.maxResults),
      pagination_token: params.paginationToken,
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
    });
  }

  /** GET /2/tweets/{id} (spec §7.4) — only when explicitly necessary. */
  getPost(postId: string): Promise<XResult<{ data?: unknown; includes?: unknown }>> {
    return this.get(`/2/tweets/${encodeURIComponent(postId)}`, {
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
    });
  }

  /** GET /2/users/by/username/{username} — resolve handle to id (spec §6.5). */
  getUserByUsername(username: string): Promise<XResult<{ data?: XUser }>> {
    return this.get(`/2/users/by/username/${encodeURIComponent(username)}`, {
      "user.fields": USER_FIELDS,
    });
  }
}

function clampResults(n: number | undefined): number {
  const v = n ?? 25;
  return Math.max(10, Math.min(100, v));
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
