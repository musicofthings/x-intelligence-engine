import { AppError } from "@xie/shared";
import {
  REPLY_JSON_SCHEMA,
  REPLY_PROMPT_VERSION,
  REPLY_SYSTEM_PROMPT,
  buildDraftUserContent,
  type DraftRequest,
} from "./prompt.js";

/**
 * Claude reply drafting. Mirrors packages/screening/src/anthropic.ts: forced tool use,
 * strict validation, one repair retry, no partial writes. This is the LLM edge — it
 * never influences the deterministic ranker or the safety checker.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TOOL_NAME = "record_reply";

export interface DraftConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export interface DraftResponse {
  reply: string;
  rationale: string;
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicResponse {
  content?: { type: string; name?: string; input?: unknown }[];
  usage?: AnthropicUsage;
}

export type FetchLike = typeof fetch;

interface Validated {
  ok: boolean;
  reply?: string;
  rationale?: string;
  issue?: string;
}

export function validateDraft(input: unknown, maxChars: number): Validated {
  if (typeof input !== "object" || input === null) return { ok: false, issue: "output was not an object" };
  const o = input as Record<string, unknown>;
  const reply = typeof o.reply === "string" ? o.reply.trim() : "";
  if (!reply) return { ok: false, issue: "reply was missing or empty" };
  // The model is asked to stay under the limit; a modest overshoot is a validation
  // failure worth one repair attempt rather than something we silently truncate.
  if (reply.length > maxChars) {
    return { ok: false, issue: `reply is ${reply.length} characters, limit is ${maxChars}` };
  }
  const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
  return { ok: true, reply, rationale };
}

export async function draftReply(
  cfg: DraftConfig,
  req: DraftRequest,
  fetchImpl: FetchLike = fetch,
): Promise<DraftResponse> {
  if (!cfg.apiKey || !cfg.model) {
    throw new AppError("CONFIGURATION_ERROR", "Claude reply drafting not configured");
  }

  const userContent = buildDraftUserContent(req);
  const tool = {
    name: TOOL_NAME,
    description: "Record the drafted reply.",
    input_schema: REPLY_JSON_SCHEMA,
  };

  const attempt = async (repairNote?: string): Promise<AnthropicResponse> => {
    const res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens ?? 512,
        system: REPLY_SYSTEM_PROMPT,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: repairNote ? `${userContent}\n\n${repairNote}` : userContent }],
      }),
    });
    if (!res.ok) {
      const code = res.status === 429 ? "RATE_LIMIT_ERROR" : "CLAUDE_API_ERROR";
      throw new AppError(code, "Claude API request failed", {
        detail: { status: res.status, body: await safeText(res) },
      });
    }
    return (await res.json()) as AnthropicResponse;
  };

  const extract = (r: AnthropicResponse): unknown =>
    r.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME)?.input;

  let resp = await attempt();
  let usage = resp.usage;
  let v = validateDraft(extract(resp), req.maxChars);

  if (!v.ok) {
    resp = await attempt(
      `Your previous output was rejected (${v.issue}). Call the ${TOOL_NAME} tool again with a valid reply of at most ${req.maxChars} characters.`,
    );
    usage = accumulate(usage, resp.usage);
    v = validateDraft(extract(resp), req.maxChars);
  }

  if (!v.ok || !v.reply) {
    throw new AppError("CLAUDE_API_ERROR", "Claude returned an invalid reply draft", {
      detail: { issue: v.issue },
    });
  }

  return {
    reply: v.reply,
    rationale: v.rationale ?? "",
    model: cfg.model,
    promptVersion: REPLY_PROMPT_VERSION,
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
  };
}

function accumulate(a: AnthropicUsage | undefined, b: AnthropicUsage | undefined): AnthropicUsage {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
