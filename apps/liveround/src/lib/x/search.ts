import type { SocialPost, VolumeReport } from "@/lib/types";
import { VOLUME_NOISY_MIN, VOLUME_QUIET_MAX } from "@/lib/types";

const API = "https://api.x.com";
const TWEET_FIELDS = "created_at,public_metrics,conversation_id,author_id";
const USER_FIELDS = "name,username,public_metrics";
const EXPANSIONS = "author_id";

export class RetryableAdapterError extends Error {
  retryable = true as const;
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RetryableAdapterError";
    this.status = status;
  }
}

interface XTweet {
  id?: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; bookmark_count?: number };
}

interface XUser {
  id?: string;
  name?: string;
  username?: string;
  public_metrics?: { followers_count?: number };
}

interface SearchResponse {
  data?: XTweet[];
  includes?: { users?: XUser[] };
  meta?: { result_count?: number };
}

export function classifyVolume(count24h: number): VolumeReport["band"] {
  if (count24h <= VOLUME_QUIET_MAX) return "quiet";
  if (count24h >= VOLUME_NOISY_MIN) return "noisy";
  return "ok";
}

export function volumeMessage(band: VolumeReport["band"], count24h: number, query: string): string {
  if (band === "quiet") {
    return `“${query}” looks too quiet (~${count24h} posts in 24h). Broaden the rule or this round will stall.`;
  }
  if (band === "noisy") {
    return `“${query}” looks too noisy (~${count24h}+ posts in 24h). Tighten the rule or raise the follower cutoff.`;
  }
  return `“${query}” looks workable (~${count24h} posts in 24h).`;
}

export async function xGet<T>(
  path: string,
  token: string,
  query: Record<string, string | number | undefined> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
  } catch {
    throw new RetryableAdapterError("X search is temporarily unavailable. Retry.");
  }
  if (res.status === 429 || res.status >= 500) {
    throw new RetryableAdapterError(`X search is temporarily unavailable (${res.status}). Retry.`, res.status);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("X token expired or missing permission. Reconnect the account in Settings.");
  }
  if (!res.ok) throw new Error(`X API ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

export async function recentSearch(
  token: string,
  params: { query: string; maxResults?: number; startTime?: string; endTime?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SearchResponse> {
  return xGet<SearchResponse>(
    "/2/tweets/search/recent",
    token,
    {
      query: params.query,
      max_results: Math.min(100, Math.max(10, params.maxResults ?? 20)),
      start_time: params.startTime,
      end_time: params.endTime,
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
    },
    fetchImpl,
  );
}

export async function usersMe(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; username: string; name: string }> {
  const body = await xGet<{ data?: XUser }>("/2/users/me", token, { "user.fields": USER_FIELDS }, fetchImpl);
  const d = body.data;
  if (!d?.id || !d.username) throw new Error("X did not return the connected user");
  return { id: d.id, username: d.username, name: d.name ?? d.username };
}

export function tweetsToPosts(body: SearchResponse): SocialPost[] {
  const users = new Map((body.includes?.users ?? []).map((u) => [u.id ?? "", u]));
  const posts: SocialPost[] = [];
  for (const tw of body.data ?? []) {
    if (!tw.id || !tw.text) continue;
    const author = users.get(tw.author_id ?? "") ?? {};
    const handle = author.username ?? "unknown";
    posts.push({
      network: "x",
      adapter: "x",
      id: tw.id,
      url: `https://x.com/${handle}/status/${tw.id}`,
      authorId: tw.author_id ?? handle,
      authorHandle: handle,
      authorName: author.name ?? handle,
      body: tw.text,
      createdAt: tw.created_at ?? new Date().toISOString(),
      conversationId: tw.conversation_id ?? tw.id,
      authorFollowers: author.public_metrics?.followers_count,
      metrics: {
        likes: tw.public_metrics?.like_count ?? 0,
        replies: tw.public_metrics?.reply_count ?? 0,
        reposts: tw.public_metrics?.retweet_count ?? 0,
        saves: tw.public_metrics?.bookmark_count ?? 0,
        comments: tw.public_metrics?.reply_count ?? 0,
      },
      media: [],
    });
  }
  return posts;
}

export async function countRecent(
  token: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<number> {
  const startTime = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const body = await recentSearch(token, { query, maxResults: 100, startTime }, fetchImpl);
  return body.meta?.result_count ?? body.data?.length ?? 0;
}
