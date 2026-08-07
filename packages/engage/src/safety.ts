import type { SafetyReport, SafetyWarning } from "@xie/shared";
import { extractUrls, linkHost, countMatches, similarity, upperRatio } from "./text.js";

/**
 * Deterministic pre-send checks (the Pounce-style "don't get your account flagged"
 * pass). Pure function, versioned, unit-tested — no Claude, no network.
 *
 * Severity contract:
 *   - "block": the reply is structurally unsendable (empty, over the platform limit).
 *   - "warn":  advisory and dismissible by the analyst. Never auto-blocks a send.
 */

export const SAFETY_RULES_VERSION = "engage-safety-v1";

/** Phrases that read as reply-farming to platform integrity systems. */
const BAIT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bfollow (me|back|for more)\b/i, label: "follow-for-follow ask" },
  { re: /\bf4f\b|\bfollowback\b/i, label: "follow-for-follow ask" },
  { re: /\b(like|rt|retweet) (and|&) (follow|share|comment)\b/i, label: "like-and-share ask" },
  { re: /\bdrop (a|your) (link|handle|@)\b/i, label: "drop-your-link ask" },
  { re: /\bcomment ['"]?\w+['"]? (and|to get|for) (i'?ll|we'?ll|get)\b/i, label: "comment-a-keyword funnel" },
  { re: /\bdm me\b/i, label: "unsolicited DM ask" },
  { re: /\bcheck out my\b/i, label: "self-promotion push" },
  { re: /\bthread\s*(🧵|below)\b.*\bfollow\b/i, label: "thread-bait" },
  { re: /\bwho else\b.*\?\s*$/i, label: "engagement-bait question" },
  { re: /\bagree\?\s*$/i, label: "engagement-bait question" },
  { re: /\bthoughts\?\s*$/i, label: "low-signal engagement-bait" },
];

/** Phrases that turn a reply into an ad. Separate from bait so the copy is clearer. */
const SELF_PROMO_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bwe (just )?(launched|built|shipped)\b/i, label: "product pitch" },
  { re: /\btry (it )?(free|now)\b/i, label: "call-to-action pitch" },
  { re: /\bsign up\b/i, label: "sign-up push" },
  { re: /\buse code\b/i, label: "promo code" },
];

export interface SafetyContext {
  /** Bodies of recently sent replies, newest first. Used for the duplicate check. */
  recentReplies: string[];
  /** Link hosts used in the reuse window, host → times used. */
  recentLinkHosts: Record<string, number>;
  /** Max times one host may appear in the window before warning. */
  linkReuseMax: number;
  /** Length ceiling for the target network. */
  maxChars: number;
  /** Trigram-similarity threshold above which a reply counts as a near-duplicate. */
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
      severity: "block",
      message: `Reply is ${text.length} characters; the limit is ${c.maxChars}.`,
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
      break; // one bait warning is enough — listing every phrase is noise
    }
  }

  for (const p of SELF_PROMO_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      warnings.push({
        code: "self_promo",
        severity: "warn",
        message: `Reads as self-promotion (${p.label}) rather than a reply.`,
        evidence: m[0],
      });
      break;
    }
  }

  // Near-duplicate of something already sent — the fastest way to look automated.
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

  // Link over-use: same destination leaned on too hard across the recent window.
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
      message: `${hashtags} hashtags — replies with more than 2 read as spam.`,
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
