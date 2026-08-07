/**
 * Pure text utilities shared by the safety checker and the ranker. No I/O, no
 * randomness, no clock — everything here is deterministic and unit-tested.
 */

/** Lowercase word tokens, punctuation stripped. Keeps intra-word apostrophes. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Character trigrams of the normalized text — robust to small edits and reordering. */
export function trigrams(text: string): Set<string> {
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  for (let i = 0; i + 3 <= norm.length; i++) out.add(norm.slice(i, i + 3));
  return out;
}

/** Jaccard overlap of two trigram sets, 0..1. Two empty strings are identical. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Similarity of two reply bodies, 0..1. */
export function similarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b));
}

/** Extract http(s) URLs verbatim. */
export function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
}

/**
 * Registrable-ish host for link-reuse counting: strips scheme, `www.`, path, and
 * query so `example.com/a` and `https://www.example.com/b?x=1` count as one link.
 */
export function linkHost(url: string): string {
  const stripped = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const host = stripped.split(/[/?#]/)[0] ?? stripped;
  return host.toLowerCase();
}

export function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** Share of alphabetic characters that are uppercase, 0..1. */
export function upperRatio(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}
