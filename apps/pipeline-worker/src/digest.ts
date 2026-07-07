import { PROMPT_VERSIONS } from "@xie/config";
import { buildPostUrl } from "@xie/shared";
import type { Ctx } from "./pipeline.js";

/**
 * Digest generation (spec §18). Deterministic assembly from stored intelligence — it
 * does NOT invent facts. Groups by topic, ranks by strategic importance, writes
 * Markdown. Idempotent digest_items (unique digest_id+post_id).
 */

const SECTION_ORDER = [
  "AI and Foundation Models", "AI for Biology", "Drug Discovery", "Oncology",
  "ctDNA/MRD", "Genomics", "Long-Read Sequencing", "Regulatory",
  "Pharma/Biotech Transactions", "Emerging Watch Items",
];

function sectionForTopic(topic: string): string {
  const t = topic.toLowerCase();
  if (t.includes("regulat") || t.includes("fda")) return "Regulatory";
  if (t.includes("onco") || t.includes("cancer")) return "Oncology";
  if (t.includes("ctdna") || t.includes("mrd") || t.includes("liquid biopsy")) return "ctDNA/MRD";
  if (t.includes("long-read") || t.includes("nanopore") || t.includes("sequenc")) return "Long-Read Sequencing";
  if (t.includes("genom")) return "Genomics";
  if (t.includes("drug") || t.includes("chemistry")) return "Drug Discovery";
  if (t.includes("biology")) return "AI for Biology";
  if (t.includes("ai") || t.includes("model") || t.includes("agent")) return "AI and Foundation Models";
  return "Emerging Watch Items";
}

export async function generateDailyDigest(ctx: Ctx, nowMs: number): Promise<string | null> {
  const end = new Date(nowMs);
  const start = new Date(nowMs - 86_400_000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const candidates = await ctx.repo.digestCandidates(startIso, endIso, 60, 40);
  if (candidates.length === 0) {
    ctx.logger.info("digest.empty", { event: "digest.empty" });
    return null;
  }

  // Group by section.
  const bySection = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const section = sectionForTopic(c.screening.topic);
    const arr = bySection.get(section) ?? [];
    arr.push(c);
    bySection.set(section, arr);
  }

  const top = candidates.slice(0, 5);
  const execSummary =
    `${candidates.length} qualified signals in the last 24h across ${bySection.size} domains. ` +
    `Top signal: ${top[0]?.screening.summary ?? ""}`;

  const lines: string[] = [`# Daily Intelligence Digest`, "", `_${startIso} → ${endIso}_`, "", "## Executive Summary", execSummary, "", "## Top Strategic Signals"];
  for (const c of top) {
    const url = c.post.url ?? buildPostUrl(c.post.authorUsername, c.post.xPostId);
    lines.push(`- **[${c.screening.strategicImportanceScore}]** ${c.screening.summary} — @${c.post.authorUsername ?? "unknown"} ([source](${url}))`);
  }
  lines.push("");

  for (const section of SECTION_ORDER) {
    const items = bySection.get(section);
    if (!items || items.length === 0) continue; // only sections with content (spec §6.8)
    lines.push(`## ${section}`);
    for (const c of items) {
      const url = c.post.url ?? buildPostUrl(c.post.authorUsername, c.post.xPostId);
      lines.push(`- ${c.screening.summary} _(${c.screening.recommendedAction})_ — [X post](${url})`);
    }
    lines.push("");
  }

  const markdown = lines.join("\n");
  const digestId = await ctx.repo.createDigest({
    type: "daily", periodStart: startIso, periodEnd: endIso,
    title: `Daily Digest ${startIso.slice(0, 10)}`, executiveSummary: execSummary,
    contentMarkdown: markdown, model: ctx.env.ANTHROPIC_MODEL || null, promptVersion: PROMPT_VERSIONS.digest,
  });
  let rank = 0;
  for (const [section, items] of bySection) {
    for (const c of items) await ctx.repo.addDigestItem(digestId, c.post.id, section, rank++);
  }
  ctx.logger.info("digest.created", { event: "digest.created", status: candidates.length });
  return digestId;
}
