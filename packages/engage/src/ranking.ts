import type { EngagementSignals } from "@xie/shared";

/**
 * Deterministic engage-queue ranking. Combines screening scores, a reply-window
 * recency bonus (the first-reply advantage is the whole point), current conversation
 * velocity, and the analyst's own learned engage/skip history.
 *
 * Pure and versioned — same inputs always produce the same order. The learning is
 * *counting*, not a model: no Claude call is involved in ordering the queue.
 */

export const RANKING_RULES_VERSION = "engage-rank-v1";

export interface RankInput {
  postId: string;
  authorUsername: string | null;
  topic: string | null;
  createdAt: string;
  strategicScore: number | null;
  relevanceScore: number | null;
  replyCount: number;
  likeCount: number;
  /** Already drafted or replied to — deprioritized, never hidden. */
  hasDraft: boolean;
  hasReply: boolean;
}

export interface RankedItem {
  postId: string;
  queueScore: number;
  reasons: string[];
}

/**
 * Recency bonus, 0..25. Full marks inside the first 15 minutes, decaying to zero at
 * 6 hours — replying to a day-old post buys nothing.
 */
export function recencyBonus(ageMinutes: number): number {
  if (ageMinutes <= 15) return 25;
  if (ageMinutes >= 360) return 0;
  return Math.round(25 * (1 - (ageMinutes - 15) / (360 - 15)));
}

/**
 * Conversation-velocity bonus, 0..10. A post with some replies is live; a post with
 * hundreds is a crowd you won't be seen in.
 */
export function velocityBonus(replyCount: number, likeCount: number): number {
  const engagement = replyCount * 2 + likeCount;
  if (engagement <= 0) return 0;
  if (replyCount > 150) return 2; // too crowded to be noticed
  const raw = Math.log10(engagement + 1) * 5;
  return Math.round(Math.max(0, Math.min(10, raw)));
}

/**
 * Learned affinity, -15..+15. Built from how often the analyst engaged vs. skipped
 * this author and topic. Needs at least 3 observations before it moves the needle,
 * so a single skip never buries a source.
 */
export function affinityBonus(
  authorUsername: string | null,
  topic: string | null,
  signals: EngagementSignals,
): number {
  const net = (key: string | null, table: Record<string, number>): number => {
    if (!key) return 0;
    const v = table[key.toLowerCase()];
    return typeof v === "number" ? v : 0;
  };
  const author = net(authorUsername, signals.authorAffinity);
  const topicNet = net(topic, signals.topicAffinity);
  const observed = signals.totalEngaged + signals.totalSkipped;
  if (observed < 3) return 0;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  // Each net engagement is worth 3 points, capped per dimension.
  return clamp(clamp(author * 3, -10, 10) + clamp(topicNet * 3, -5, 5), -15, 15);
}

export function rankOne(item: RankInput, signals: EngagementSignals, nowMs: number): RankedItem {
  const reasons: string[] = [];

  const strategic = item.strategicScore ?? item.relevanceScore ?? 0;
  let score = Math.round(strategic * 0.5); // 0..50
  if (strategic > 0) reasons.push(`strategic ${strategic}`);

  const ageMinutes = Math.max(0, (nowMs - Date.parse(item.createdAt || "")) / 60_000);
  const rec = Number.isFinite(ageMinutes) ? recencyBonus(ageMinutes) : 0;
  score += rec;
  if (rec >= 20) reasons.push("fresh — reply window open");
  else if (rec === 0) reasons.push("older than 6h");

  const vel = velocityBonus(item.replyCount, item.likeCount);
  score += vel;
  if (item.replyCount > 150) reasons.push("crowded thread");
  else if (vel >= 6) reasons.push("active conversation");

  const aff = affinityBonus(item.authorUsername, item.topic, signals);
  score += aff;
  if (aff > 0) reasons.push("you usually engage here");
  else if (aff < 0) reasons.push("you usually skip these");

  if (item.hasReply) {
    score -= 40;
    reasons.push("already replied");
  } else if (item.hasDraft) {
    score -= 10;
    reasons.push("draft in progress");
  }

  return { postId: item.postId, queueScore: Math.max(0, Math.min(100, score)), reasons };
}

/** Rank a batch, highest first. Ties break on post id so the order is stable. */
export function rankQueue(items: RankInput[], signals: EngagementSignals, nowMs: number): RankedItem[] {
  return items
    .map((i) => rankOne(i, signals, nowMs))
    .sort((a, b) => b.queueScore - a.queueScore || a.postId.localeCompare(b.postId));
}

export const EMPTY_SIGNALS: EngagementSignals = {
  authorAffinity: {},
  topicAffinity: {},
  totalEngaged: 0,
  totalSkipped: 0,
};
