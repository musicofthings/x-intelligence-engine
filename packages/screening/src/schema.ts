import { z } from "zod";
import type { ScreeningResult } from "@xie/shared";

/** Screening output schema (spec §15). Scores are integers 0..100. */

const score = z.number().int().min(0).max(100);

export const ScreeningEntitySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum([
    "company",
    "person",
    "drug",
    "target",
    "trial",
    "model",
    "technology",
    "regulator",
    "conference",
    "other",
  ]),
});

export const ScreeningResultSchema = z.object({
  relevance_score: score,
  novelty_score: score,
  credibility_score: score,
  strategic_importance_score: score,
  topic: z.string().min(1).max(120),
  subtopic: z.string().max(120).default(""),
  requires_followup: z.boolean(),
  reason: z.string().min(1).max(2000),
  summary: z.string().min(1).max(2000),
  recommended_action: z.string().min(1).max(1000),
  entities: z.array(ScreeningEntitySchema).max(50).default([]),
  risks: z.array(z.string().max(500)).max(30).default([]),
  evidence: z.array(z.string().max(500)).max(30).default([]),
});

export type ScreeningResultRaw = z.infer<typeof ScreeningResultSchema>;

/** JSON Schema handed to the Anthropic tool-use API for forced structured output. */
export const SCREENING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "relevance_score",
    "novelty_score",
    "credibility_score",
    "strategic_importance_score",
    "topic",
    "subtopic",
    "requires_followup",
    "reason",
    "summary",
    "recommended_action",
    "entities",
    "risks",
    "evidence",
  ],
  properties: {
    relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    novelty_score: { type: "integer", minimum: 0, maximum: 100 },
    credibility_score: { type: "integer", minimum: 0, maximum: 100 },
    strategic_importance_score: { type: "integer", minimum: 0, maximum: 100 },
    topic: { type: "string" },
    subtopic: { type: "string" },
    requires_followup: { type: "boolean" },
    reason: { type: "string" },
    summary: { type: "string" },
    recommended_action: { type: "string" },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type"],
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: [
              "company",
              "person",
              "drug",
              "target",
              "trial",
              "model",
              "technology",
              "regulator",
              "conference",
              "other",
            ],
          },
        },
      },
    },
    risks: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
  },
} as const;

/** Map validated snake_case output to the internal camelCase domain type. */
export function toScreeningResult(raw: ScreeningResultRaw): ScreeningResult {
  return {
    relevanceScore: raw.relevance_score,
    noveltyScore: raw.novelty_score,
    credibilityScore: raw.credibility_score,
    strategicImportanceScore: raw.strategic_importance_score,
    topic: raw.topic,
    subtopic: raw.subtopic,
    requiresFollowup: raw.requires_followup,
    reason: raw.reason,
    summary: raw.summary,
    recommendedAction: raw.recommended_action,
    entities: raw.entities,
    risks: raw.risks,
    evidence: raw.evidence,
  };
}

export interface ScreeningValidation {
  ok: boolean;
  result?: ScreeningResult;
  issues?: { path: string; message: string }[];
}

export function validateScreening(candidate: unknown): ScreeningValidation {
  const parsed = ScreeningResultSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  return { ok: true, result: toScreeningResult(parsed.data) };
}
