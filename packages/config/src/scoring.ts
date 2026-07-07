/** Screening decision bands (spec §17) and prompt versions (spec §57). Configurable. */

export const PROMPT_VERSIONS = {
  screen: "x-intel-screen-v1",
  digest: "x-intel-digest-v1",
} as const;

export const PREFILTER_RULES_VERSION = "x-intel-prefilter-v1";

export interface ScoreBands {
  discardMax: number; // 0..discardMax -> discard from priority workflow
  archiveMax: number; // ..archiveMax -> archive/searchable
  digestMax: number; // ..digestMax -> daily digest candidate
  priorityMax: number; // ..priorityMax -> priority intelligence
  // above priorityMax -> immediate alert candidate
}

export const DEFAULT_SCORE_BANDS: ScoreBands = {
  discardMax: 39,
  archiveMax: 59,
  digestMax: 74,
  priorityMax: 89,
};

export type ScoreBand = "discard" | "archive" | "digest" | "priority" | "alert";

export function bandForScore(score: number, bands: ScoreBands = DEFAULT_SCORE_BANDS): ScoreBand {
  if (score <= bands.discardMax) return "discard";
  if (score <= bands.archiveMax) return "archive";
  if (score <= bands.digestMax) return "digest";
  if (score <= bands.priorityMax) return "priority";
  return "alert";
}

export interface SourcePriorityBand {
  label: string;
  min: number;
  max: number;
}

/** Conceptual source-priority bands (spec §54). Priority is NOT truth. */
export const SOURCE_PRIORITY_BANDS: SourcePriorityBand[] = [
  { label: "critical primary source", min: 90, max: 100 },
  { label: "high-value source", min: 75, max: 89 },
  { label: "normal source", min: 50, max: 74 },
  { label: "low-priority source", min: 25, max: 49 },
  { label: "noisy source", min: 0, max: 24 },
];
