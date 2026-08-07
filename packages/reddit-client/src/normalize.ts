import type { NormalizedXPost } from "@xie/shared";
import type { RedditListing, RedditPostData } from "./types.js";

/**
 * Map Reddit listings onto the canonical post shape so the existing pipeline
 * (dedupe → prefilter → screening → alerts → digests → feed) works unchanged.
 *
 * `xPostId` carries the Reddit fullname (`t3_…`), which can never collide with an X
 * snowflake id, so the global UNIQUE on posts.x_post_id stays correct across networks.
 */

const REDDIT_BASE = "https://www.reddit.com";

/** Reddit's tombstones for deleted/removed content — never worth screening. */
const TOMBSTONES = new Set(["[deleted]", "[removed]"]);

export function normalizeRedditPost(d: RedditPostData): NormalizedXPost | null {
  const fullname = typeof d.name === "string" && d.name ? d.name : d.id ? `t3_${d.id}` : "";
  if (!fullname) return null;

  const title = typeof d.title === "string" ? d.title : "";
  const selftext = typeof d.selftext === "string" ? d.selftext : "";
  if (TOMBSTONES.has(selftext.trim()) && !title) return null;

  // Title carries the signal; body adds context. Bounded so one long post can't
  // dominate a screening prompt.
  const text = [title, TOMBSTONES.has(selftext.trim()) ? "" : selftext]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000)
    .trim();
  if (!text) return null;

  const createdMs = typeof d.created_utc === "number" ? d.created_utc * 1000 : NaN;
  const author = typeof d.author === "string" && !TOMBSTONES.has(d.author) ? d.author : null;
  const permalink = typeof d.permalink === "string" ? d.permalink : "";

  return {
    network: "reddit",
    xPostId: fullname,
    authorId: typeof d.author_fullname === "string" ? d.author_fullname : "",
    authorUsername: author,
    authorName: author,
    text,
    lang: null, // Reddit does not expose a language field
    createdAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : "",
    conversationId: fullname,
    inReplyToUserId: null,
    url: permalink ? `${REDDIT_BASE}${permalink}` : (typeof d.url === "string" ? d.url : null),
    metrics: {
      likeCount: numOr0(d.score ?? d.ups),
      repostCount: 0,
      replyCount: numOr0(d.num_comments),
      quoteCount: 0,
      bookmarkCount: 0,
      impressionCount: 0,
    },
    raw: d,
  };
}

export interface NormalizeOptions {
  /** Drop NSFW posts. Defaults to true. */
  excludeNsfw?: boolean;
  /** Drop mod-stickied announcements. Defaults to true. */
  excludeStickied?: boolean;
}

export function normalizeRedditListing(
  listing: RedditListing,
  opts: NormalizeOptions = {},
): { posts: NormalizedXPost[]; after: string | null } {
  const excludeNsfw = opts.excludeNsfw !== false;
  const excludeStickied = opts.excludeStickied !== false;
  const posts: NormalizedXPost[] = [];

  for (const child of listing.data?.children ?? []) {
    if (child.kind && child.kind !== "t3") continue; // links only, never comments
    const d = child.data;
    if (!d) continue;
    if (excludeNsfw && d.over_18) continue;
    if (excludeStickied && d.stickied) continue;
    if (d.removed_by_category) continue;
    const p = normalizeRedditPost(d);
    if (p) posts.push(p);
  }

  return { posts, after: listing.data?.after ?? null };
}

/** Build the `q` value for a Reddit search from a monitor's keyword list. */
export function buildRedditQuery(keywords: string[]): string {
  const terms = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 10) // Reddit search degrades badly past ~10 OR-ed terms
    .map((k) => (/\s/.test(k) ? `"${k.replace(/"/g, "")}"` : k));
  return terms.length > 1 ? `(${terms.join(" OR ")})` : (terms[0] ?? "");
}

function numOr0(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}
