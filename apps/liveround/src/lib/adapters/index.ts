import { env, redditConfigured } from "@/lib/env";
import type { AdapterDiscoverInput, SocialAdapter, SocialPost, SubredditRef } from "@/lib/types";
import { mockXAdapter } from "./mock-x";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

interface RedditPostData {
  id?: string;
  name?: string;
  author?: string;
  author_fullname?: string;
  title?: string;
  selftext?: string;
  subreddit?: string;
  created_utc?: number;
  permalink?: string;
  url?: string;
  score?: number;
  ups?: number;
  num_comments?: number;
  over_18?: boolean;
  stickied?: boolean;
  preview?: { images?: { source?: { url?: string } }[] };
}

interface RedditListing {
  data?: { children?: { kind?: string; data?: RedditPostData }[] };
}

function cleanSubreddit(s: string): string {
  return s.trim().replace(/^\/?r\//i, "").replace(/[^A-Za-z0-9_]/g, "");
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

let cached: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (!env.redditClientId || !env.redditClientSecret) {
    throw new Error("Reddit API is not configured");
  }
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.value;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${b64(`${env.redditClientId}:${env.redditClientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": env.redditUserAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit token request failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Reddit returned no access token");
  cached = {
    value: body.access_token,
    expiresAt: now + Math.max(60, body.expires_in ?? 3600) * 1000,
  };
  return cached.value;
}

async function redditGet<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
  const token = await accessToken();
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${token}`, "user-agent": env.redditUserAgent },
  });
  if (res.status === 401) cached = null;
  if (!res.ok) throw new Error(`Reddit API ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

function toPost(d: RedditPostData): SocialPost | null {
  const fullname = d.name || (d.id ? `t3_${d.id}` : "");
  if (!fullname) return null;
  if (d.over_18 || d.stickied) return null;
  const title = d.title ?? "";
  const selftext = d.selftext && d.selftext !== "[deleted]" && d.selftext !== "[removed]" ? d.selftext : "";
  const body = [title, selftext].filter(Boolean).join("\n\n").slice(0, 8000).trim();
  if (!body) return null;
  const created = typeof d.created_utc === "number" ? d.created_utc * 1000 : Date.now();
  const handle = d.author && d.author !== "[deleted]" ? d.author : "unknown";
  const permalink = d.permalink ?? "";
  const image = d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&");
  return {
    network: "reddit",
    adapter: "reddit",
    id: fullname,
    url: permalink ? `https://www.reddit.com${permalink}` : (d.url ?? `https://www.reddit.com/${fullname}`),
    authorId: d.author_fullname ?? handle,
    authorHandle: handle,
    authorName: `u/${handle}`,
    body,
    createdAt: new Date(created).toISOString(),
    conversationId: fullname,
    metrics: {
      likes: Number(d.score ?? d.ups ?? 0) || 0,
      replies: Number(d.num_comments ?? 0) || 0,
      reposts: 0,
      saves: 0,
      comments: Number(d.num_comments ?? 0) || 0,
    },
    media: image ? [{ kind: "image", url: image, alt: title }] : [],
    replyTargets: [
      {
        id: fullname,
        kind: "post",
        authorHandle: handle,
        body: body.slice(0, 280),
        url: permalink ? `https://www.reddit.com${permalink}` : "",
      },
    ],
  };
}

const FALLBACK_REDDIT: SocialPost[] = [
  {
    network: "reddit",
    adapter: "reddit",
    id: "t3_liveround_demo_1",
    url: "https://www.reddit.com/r/startups/comments/demo1",
    authorId: "t2_demo",
    authorHandle: "quietoperator",
    authorName: "u/quietoperator",
    body: "How are you showing up in customer conversations on Reddit without it turning into a second full-time job? Keyword alerts are too noisy.",
    createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    conversationId: "t3_liveround_demo_1",
    metrics: { likes: 48, replies: 14, reposts: 0, saves: 0, comments: 14 },
    media: [],
    replyTargets: [
      {
        id: "t3_liveround_demo_1",
        kind: "post",
        authorHandle: "quietoperator",
        body: "How are you showing up in customer conversations on Reddit…",
        url: "https://www.reddit.com/r/startups/comments/demo1",
      },
    ],
  },
];

/**
 * Official Reddit API adapter. Application-only OAuth. No scraping.
 * HUMAN PRESS RULE: no comment/submit write calls live here.
 */
export class RedditAdapter implements SocialAdapter {
  id = "reddit" as const;
  network = "reddit" as const;
  label = "Reddit";
  get configured() {
    return redditConfigured();
  }

  async discover(input: AdapterDiscoverInput): Promise<SocialPost[]> {
    const subs = input.campaign.subreddits.map((s) => s.name).filter(Boolean);
    if (!this.configured) {
      return FALLBACK_REDDIT.filter((p) => p.createdAt >= input.sinceIso);
    }
    if (subs.length === 0) return [];
    const listing = await redditGet<RedditListing>(`/r/${subs.join("+")}/new`, {
      limit: Math.min(25, input.limit),
      raw_json: 1,
    });
    const posts: SocialPost[] = [];
    for (const child of listing.data?.children ?? []) {
      if (child.kind && child.kind !== "t3") continue;
      if (!child.data) continue;
      const p = toPost(child.data);
      if (p && p.createdAt >= input.sinceIso) posts.push(p);
    }
    return posts.slice(0, input.limit);
  }

  async validateTarget(raw: string): Promise<SubredditRef> {
    const name = cleanSubreddit(raw);
    if (!name) throw new Error("Enter a subreddit name");
    if (!this.configured) {
      return {
        name,
        title: name,
        description: "Reddit API is not configured — name stored, description pending.",
        members: 0,
      };
    }
    const about = await redditGet<{
      data?: { display_name?: string; subscribers?: number; public_description?: string; title?: string };
    }>(`/r/${name}/about`, { raw_json: 1 });
    const d = about.data;
    if (!d?.display_name) throw new Error(`r/${name} was not found`);
    return {
      name: d.display_name,
      title: d.title ?? d.display_name,
      description: d.public_description ?? "",
      members: d.subscribers ?? 0,
    };
  }
}

export const redditAdapter = new RedditAdapter();

export function adapterFor(network: "x" | "reddit"): SocialAdapter {
  if (network === "reddit") return redditAdapter;
  return mockXAdapter;
}

export function listAdapters(): SocialAdapter[] {
  return [mockXAdapter, redditAdapter];
}
