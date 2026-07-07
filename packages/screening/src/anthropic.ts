import { AppError, type ScreeningResult } from "@xie/shared";
import {
  SCREENING_JSON_SCHEMA,
  validateScreening,
} from "./schema.js";
import {
  SCREENING_SYSTEM_PROMPT,
  SCREENING_PROMPT_VERSION,
  buildScreeningUserContent,
  type MonitorScreeningContext,
} from "./prompt.js";

/**
 * Minimal Anthropic Messages client using raw fetch (Workers-compatible). Forces
 * structured output via tool use, validates strictly, and performs ONE repair retry
 * (spec §14). Never accepts malformed output into production tables.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TOOL_NAME = "record_screening";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export interface ScreeningInput {
  monitor: MonitorScreeningContext;
  post: { text: string; authorUsername: string | null; createdAt: string; lang: string | null };
}

export interface ScreeningResponse {
  result: ScreeningResult;
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: AnthropicUsage;
  stop_reason?: string;
}

/** Injectable fetch for testing; defaults to global fetch. */
export type FetchLike = typeof fetch;

export async function screenPost(
  cfg: AnthropicConfig,
  input: ScreeningInput,
  fetchImpl: FetchLike = fetch,
): Promise<ScreeningResponse> {
  if (!cfg.apiKey || !cfg.model) {
    throw new AppError("CONFIGURATION_ERROR", "Claude screening not configured");
  }

  const userContent = buildScreeningUserContent(input.monitor, input.post);
  const tool = {
    name: TOOL_NAME,
    description: "Record the structured intelligence-screening assessment of the post.",
    input_schema: SCREENING_JSON_SCHEMA,
  };

  const attempt = async (repairNote?: string): Promise<AnthropicResponse> => {
    const messages: { role: "user"; content: string }[] = [
      { role: "user", content: repairNote ? `${userContent}\n\n${repairNote}` : userContent },
    ];
    const res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens ?? 1024,
        system: SCREENING_SYSTEM_PROMPT,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages,
      }),
    });
    if (!res.ok) {
      const status = res.status;
      const code = status === 429 ? "RATE_LIMIT_ERROR" : "CLAUDE_API_ERROR";
      const body = await safeText(res);
      throw new AppError(code, "Claude API request failed", { detail: { status, body } });
    }
    return (await res.json()) as AnthropicResponse;
  };

  const extract = (resp: AnthropicResponse): unknown => {
    const block = resp.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    return block?.input;
  };

  // First attempt
  let resp = await attempt();
  let usage = resp.usage;
  let validation = validateScreening(extract(resp));

  // One repair retry on validation failure
  if (!validation.ok) {
    const note = `Your previous output did not conform to the schema (${(validation.issues ?? [])
      .map((i) => `${i.path}: ${i.message}`)
      .join("; ")}). Call the ${TOOL_NAME} tool again with valid data.`;
    resp = await attempt(note);
    usage = accumulate(usage, resp.usage);
    validation = validateScreening(extract(resp));
  }

  if (!validation.ok || !validation.result) {
    throw new AppError("CLAUDE_API_ERROR", "Claude returned invalid screening output", {
      detail: { issues: validation.issues },
    });
  }

  return {
    result: validation.result,
    model: cfg.model,
    promptVersion: SCREENING_PROMPT_VERSION,
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
