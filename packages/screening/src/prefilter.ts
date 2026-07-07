import type { NormalizedXPost, PrefilterFactor, PrefilterResult } from "@xie/shared";
import { PREFILTER_RULES_VERSION } from "@xie/config";

/**
 * Deterministic, transparent, versioned prefilter (spec §13). Runs BEFORE any Claude
 * call. Every factor is explainable and stored. This is the deterministic core — it
 * must never depend on an LLM. Follower count is deliberately NOT used as a proxy for
 * truth (spec §13, §54).
 */

export interface PrefilterContext {
  /** Priority of the post author (0..100), from source/watchlist config. */
  authorPriority?: number;
  /** Whether the author is a recognized official company account. */
  isOfficialAccount?: boolean;
  /** Whether the author is a recognized scientific/institutional source. */
  isRecognizedScientificSource?: boolean;
  /** Priority keywords (lowercase) that indicate strategic relevance. */
  priorityKeywords: string[];
  /** Exact strategic phrases (lowercase) worth extra weight. */
  strategicPhrases: string[];
  /** Excluded terms (lowercase) that hard-penalize. */
  excludedTerms: string[];
  /** Number of monitors this post matched. */
  monitorMatchCount: number;
  /** Whether we've seen a near-duplicate of this text already. */
  isNearDuplicate?: boolean;
  /** Whether this looks like a repost/quote-only duplication. */
  isRepostDuplicate?: boolean;
  /** Pass threshold; posts scoring below are rejected. */
  threshold: number;
}

const PRIMARY_SOURCE_HOST_HINTS = [
  "doi.org",
  "nature.com",
  "science.org",
  "nejm.org",
  "thelancet.com",
  "cell.com",
  "biorxiv.org",
  "medrxiv.org",
  "arxiv.org",
  "clinicaltrials.gov",
  "fda.gov",
  "ema.europa.eu",
  "pubmed.ncbi.nlm.nih.gov",
  "sec.gov",
];

const GIVEAWAY_SPAM_RE =
  /\b(giveaway|airdrop|free\s+nft|retweet\s+to\s+win|follow\s+&?\s*rt|promo\s?code|use\s+code)\b/i;
const LOW_INFO_RE = /^(?:\s*(?:gm|good morning|thread\s*👇|🔥+|this\.?|so true|lol|wow|amazing)\s*)$/i;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function engagementFactor(post: NormalizedXPost): number {
  const m = post.metrics;
  const total = m.likeCount + m.repostCount * 2 + m.replyCount + m.quoteCount * 2 + m.bookmarkCount * 2;
  if (total >= 5000) return 15;
  if (total >= 1000) return 10;
  if (total >= 200) return 5;
  return 0;
}

function containsPrimarySource(text: string): boolean {
  const lower = text.toLowerCase();
  return PRIMARY_SOURCE_HOST_HINTS.some((h) => lower.includes(h));
}

export function prefilter(post: NormalizedXPost, ctx: PrefilterContext): PrefilterResult {
  const reasons: PrefilterFactor[] = [];
  const text = post.text ?? "";
  const lower = text.toLowerCase();

  const add = (key: string, label: string, points: number) => {
    if (points !== 0) reasons.push({ key, label, points });
  };

  // ── Source / author factors ──────────────────────────────────────────────
  let sourceScore = 0;
  const ap = ctx.authorPriority ?? 0;
  if (ap >= 90) {
    sourceScore += 25;
    add("high_priority_author", "High-priority author", 25);
  } else if (ap >= 60) {
    sourceScore += 15;
    add("medium_priority_author", "Medium-priority author", 15);
  }
  if (ctx.isOfficialAccount) {
    sourceScore += 15;
    add("official_company_account", "Official company account", 15);
  }
  if (ctx.isRecognizedScientificSource) {
    sourceScore += 15;
    add("recognized_scientific_source", "Recognized scientific source", 15);
  }

  // ── Keyword / phrase factors ─────────────────────────────────────────────
  let keywordScore = 0;
  if (ctx.priorityKeywords.some((k) => k && lower.includes(k))) {
    keywordScore += 20;
    add("priority_keyword", "Priority keyword", 20);
  }
  if (ctx.strategicPhrases.some((p) => p && lower.includes(p))) {
    keywordScore += 15;
    add("strategic_phrase", "Exact strategic phrase", 15);
  }

  // ── Primary source factor ────────────────────────────────────────────────
  let primarySourceScore = 0;
  if (containsPrimarySource(lower)) {
    primarySourceScore += 15;
    add("primary_source_link", "Primary-source link", 15);
  }

  // ── Engagement factors (never a truth proxy; capped) ─────────────────────
  let engagementScore = engagementFactor(post);
  if (engagementScore > 0) add("engagement", "Strong engagement", engagementScore);
  if (ctx.monitorMatchCount > 1) {
    engagementScore += 10;
    add("multi_monitor", "Matches multiple monitors", 10);
  }

  // ── Penalties ────────────────────────────────────────────────────────────
  let penaltyScore = 0;
  if (ctx.isRepostDuplicate) {
    penaltyScore -= 30;
    add("repost_duplicate", "Obvious repost duplication", -30);
  }
  if (GIVEAWAY_SPAM_RE.test(text)) {
    penaltyScore -= 40;
    add("giveaway_spam", "Giveaway/promotion spam", -40);
  }
  if (LOW_INFO_RE.test(text.trim()) || text.trim().length < 15) {
    penaltyScore -= 20;
    add("low_information", "Low-information generic content", -20);
  }
  if (ctx.isNearDuplicate) {
    penaltyScore -= 30;
    add("near_duplicate", "Repeated near-duplicate", -30);
  }
  const hitExcluded = ctx.excludedTerms.some((t) => t && lower.includes(t));
  if (hitExcluded) {
    penaltyScore -= 50;
    add("excluded_term", "Excluded term", -50);
  }

  const rawScore = sourceScore + keywordScore + primarySourceScore + engagementScore + penaltyScore;
  const score = clamp(rawScore, 0, 100);
  const decision = score >= ctx.threshold ? "pass" : "reject";

  return {
    score,
    keywordScore,
    sourceScore,
    engagementScore,
    primarySourceScore,
    penaltyScore,
    decision,
    reasons,
    rulesVersion: PREFILTER_RULES_VERSION,
  };
}
