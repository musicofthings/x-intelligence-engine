import type { SafetyReport, SafetyWarning } from "@/lib/types";
import { countMatches, extractUrls, linkHost, similarity, upperRatio } from "./text";

/**
 * Deterministic pre-send checks. Engagement bait, near-duplicates, and overused
 * links warn — they never hard-block. Empty / over-limit are structural.
 *
 * Ported from the intelligence engine (`engage-safety-v1`) and kept warn-not-block
 * for the product rules in LiveRound.
 */

export const SAFETY_RULES_VERSION = "liveround-safety-v1";

const BAIT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bfollow (me|back|for more)\b/i, label: "follow-for-follow ask" },
  { re: /\bf4f\b|\bfollowback\b/i, label: "follow-for-follow ask" },
  { re: /\b(like|rt|retweet) (and|&) (follow|share|comment)\b/i, label: "like-and-share ask" },
  { re: /\bdrop (a|your) (link|handle|@)\b/i, label: "drop-your-link ask" },
  { re: /\bdm me\b/i, label: "unsolicited DM ask" },
  { re: /\bcheck out my\b/i, label: "self-promotion push" },
  { re: /\bwho else\b.*\?\s*$/i, label: "engagement-bait question" },
  { re: /\bagree\?\s*$/i, label: "engagement-bait question" },
  { re: /\bthoughts\?\s*$/i, label: "low-signal engagement-bait" },
];

const SELF_PROMO_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bwe (just )?(launched|built|shipped)\b/i, label: "product pitch" },
  { re: /\btry (it )?(free|now)\b/i, label: "call-to-action pitch" },
  { re: /\bsign up\b/i, label: "sign-up push" },
  { re: /\buse code\b/i, label: "promo code" },
];

export interface SafetyContext {
  recentReplies: string[];
  recentLinkHosts: Record<string, number>;
  linkReuseMax: number;
  maxChars: number;
  similarityThreshold: number;
}

export const DEFAULT_SAFETY_CONTEXT: SafetyContext = {
  recentReplies: [],
  recentLinkHosts: {},
  linkReuseMax: 3,
  maxChars: 280,
  similarityThreshold: 0.6,
};

export function checkReply(body: string, ctx: Partial<SafetyContext> = {}): SafetyReport {
  const c: SafetyContext = { ...DEFAULT_SAFETY_CONTEXT, ...ctx };
  const warnings: SafetyWarning[] = [];
  const text = body.trim();

  if (text.length === 0) {
    warnings.push({ code: "empty", severity: "block", message: "Reply is empty.", evidence: null });
    return { warnings, sendable: false, rulesVersion: SAFETY_RULES_VERSION };
  }

  if (text.length > c.maxChars) {
    warnings.push({
      code: "too_long",
      severity: "warn",
      message: `This draft is ${text.length} characters; the platform limit is ${c.maxChars}.`,
      evidence: null,
    });
  }

  for (const p of BAIT_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      warnings.push({
        code: "engagement_bait",
        severity: "warn",
        message: `Reads as engagement bait (${p.label}).`,
        evidence: m[0],
      });
      break;
    }
  }

  for (const p of SELF_PROMO_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      warnings.push({
        code: "self_promo",
        severity: "warn",
        message: `Reads as a pitch (${p.label}) rather than a reply.`,
        evidence: m[0],
      });
      break;
    }
  }

  let best = { score: 0, body: "" };
  for (const prev of c.recentReplies) {
    const s = similarity(text, prev);
    if (s > best.score) best = { score: s, body: prev };
  }
  if (best.score >= c.similarityThreshold) {
    warnings.push({
      code: "duplicate_reply",
      severity: "warn",
      message: `${Math.round(best.score * 100)}% similar to a reply you already sent.`,
      evidence: best.body.slice(0, 120),
    });
  }

  const hostsInThisReply = new Set(extractUrls(text).map(linkHost));
  for (const host of hostsInThisReply) {
    const prior = c.recentLinkHosts[host] ?? 0;
    if (prior + 1 > c.linkReuseMax) {
      warnings.push({
        code: "link_overuse",
        severity: "warn",
        message: `You've linked ${host} ${prior} times recently; this would be ${prior + 1}.`,
        evidence: host,
      });
    }
  }

  const hashtags = countMatches(text, /(^|\s)#[a-z0-9_]+/gi);
  if (hashtags > 2) {
    warnings.push({
      code: "excessive_hashtags",
      severity: "warn",
      message: `${hashtags} hashtags — more than two reads as spam.`,
      evidence: null,
    });
  }

  const mentions = countMatches(text, /(^|\s)@[a-z0-9_]+/gi);
  if (mentions > 3) {
    warnings.push({
      code: "excessive_mentions",
      severity: "warn",
      message: `${mentions} mentions — mass-tagging is a common flag trigger.`,
      evidence: null,
    });
  }

  if (text.length >= 20 && upperRatio(text) > 0.6) {
    warnings.push({
      code: "all_caps",
      severity: "warn",
      message: "Mostly uppercase — reads as shouting.",
      evidence: null,
    });
  }

  return {
    warnings,
    sendable: !warnings.some((w) => w.severity === "block"),
    rulesVersion: SAFETY_RULES_VERSION,
  };
}
