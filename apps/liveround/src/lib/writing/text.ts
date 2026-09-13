/**
 * Pure text utilities for the safety net and filter learning.
 * Ported from the intelligence engine's deterministic engage core.
 */

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function trigrams(text: string): Set<string> {
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  for (let i = 0; i + 3 <= norm.length; i++) out.add(norm.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function similarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b));
}

export function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
}

export function linkHost(url: string): string {
  const stripped = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const host = stripped.split(/[/?#]/)[0] ?? stripped;
  return host.toLowerCase();
}

export function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function upperRatio(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}

export function overlapScore(doc: string, post: string): number {
  const a = new Set(tokenize(doc));
  const b = new Set(tokenize(post));
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of b) if (a.has(t)) hit++;
  return hit / Math.max(6, Math.min(a.size, 40));
}
