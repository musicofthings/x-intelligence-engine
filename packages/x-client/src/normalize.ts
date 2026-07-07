import type { NormalizedXPost, PostMetrics } from "@xie/shared";
import { toSnowflake, buildPostUrl } from "@xie/shared";
import type { XTweet, XUser, XIncludes } from "./types.js";

/**
 * Normalize a raw X tweet + expansions into the canonical `NormalizedXPost`
 * (spec §12 stage B). Handles missing optional fields. X ids stay strings.
 */

function metrics(t: XTweet): PostMetrics {
  const m = t.public_metrics ?? {};
  return {
    likeCount: m.like_count ?? 0,
    repostCount: m.retweet_count ?? 0,
    replyCount: m.reply_count ?? 0,
    quoteCount: m.quote_count ?? 0,
    bookmarkCount: m.bookmark_count ?? 0,
    impressionCount: m.impression_count ?? 0,
  };
}

export function indexUsers(includes: XIncludes | undefined): Map<string, XUser> {
  const map = new Map<string, XUser>();
  for (const u of includes?.users ?? []) map.set(u.id, u);
  return map;
}

export function normalizeTweet(t: XTweet, users: Map<string, XUser>): NormalizedXPost {
  const xPostId = toSnowflake(t.id);
  const author = t.author_id ? users.get(t.author_id) : undefined;
  const authorUsername = author?.username ?? null;

  return {
    xPostId,
    authorId: t.author_id ? toSnowflake(t.author_id) : "",
    authorUsername,
    authorName: author?.name ?? null,
    text: t.text ?? "",
    lang: t.lang ?? null,
    createdAt: t.created_at ?? "",
    conversationId: t.conversation_id ? toSnowflake(t.conversation_id) : null,
    inReplyToUserId: t.in_reply_to_user_id ? toSnowflake(t.in_reply_to_user_id) : null,
    url: buildPostUrl(authorUsername, xPostId),
    metrics: metrics(t),
    raw: t,
  };
}

export function normalizeSearchResponse(resp: {
  data?: XTweet[];
  includes?: XIncludes;
}): NormalizedXPost[] {
  const users = indexUsers(resp.includes);
  return (resp.data ?? []).map((t) => normalizeTweet(t, users));
}

/** Detect obvious repost/quote-only duplication for the prefilter (spec §13). */
export function isRepostDuplicate(t: XTweet): boolean {
  const refs = t.referenced_tweets ?? [];
  return refs.some((r) => r.type === "retweeted") || t.text.startsWith("RT @");
}
