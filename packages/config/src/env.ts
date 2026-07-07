import { z } from "zod";
import { AppError } from "@xie/shared";

/** Coerce common truthy env strings to boolean. */
const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const numFromString = (def: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return def;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : def;
    });

/**
 * Full runtime environment schema. Secrets are optional at parse-time so the app
 * boots in a "not configured" state and reports capability gaps (spec §47) rather
 * than crashing. Presence is checked where a capability is actually used.
 */
export const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_VERSION: z.string().default("local"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  APP_TIMEZONE: z.string().default("Asia/Kolkata"),

  AUTH_MODE: z.enum(["development", "cloudflare_access"]).default("development"),
  CF_ACCESS_TEAM_DOMAIN: z.string().optional().default(""),
  CF_ACCESS_AUD: z.string().optional().default(""),
  ALLOWED_EMAILS: z.string().optional().default(""),

  X_BEARER_TOKEN: z.string().optional().default(""),
  X_API_BASE_URL: z.string().default("https://api.x.com"),
  X_WEBHOOK_SECRET: z.string().optional().default(""),
  X_POST_READ_UNIT_COST_USD: numFromString(0),
  X_USER_READ_UNIT_COST_USD: numFromString(0),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default(""),
  CLAUDE_INPUT_COST_PER_MILLION: numFromString(3),
  CLAUDE_OUTPUT_COST_PER_MILLION: numFromString(15),

  MCP_API_TOKEN: z.string().optional().default(""),
  MCP_ALLOW_MUTATIONS: boolFromString.default(false),

  ALERT_WEBHOOK_URL: z.string().optional().default(""),

  X_DAILY_RESOURCE_BUDGET: numFromString(5000),
  X_MONTHLY_RESOURCE_BUDGET: numFromString(100000),
  CLAUDE_DAILY_REQUEST_BUDGET: numFromString(500),
  HARD_STOP_ON_BUDGET_EXCEEDED: boolFromString.default(true),

  ENABLE_RAW_ARCHIVE: boolFromString.default(false),
  ENABLE_VECTOR_SEARCH: boolFromString.default(false),
  DEMO_MODE: boolFromString.default(false),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("CONFIGURATION_ERROR", "Invalid environment configuration", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const env = parsed.data;

  // Security invariant (spec §24): dev auth + demo mode are forbidden in production.
  if (env.APP_ENV === "production") {
    if (env.AUTH_MODE === "development") {
      throw new AppError("CONFIGURATION_ERROR", "AUTH_MODE=development is refused in production");
    }
    if (env.DEMO_MODE) {
      throw new AppError("CONFIGURATION_ERROR", "DEMO_MODE=true is refused in production");
    }
  }
  return env;
}

/** Capability detection derived from env (spec §2.1, §47). */
export interface Capabilities {
  xApiConfigured: boolean;
  claudeConfigured: boolean;
  mcpConfigured: boolean;
  webhookConfigured: boolean;
  rawArchiveEnabled: boolean;
  vectorSearchEnabled: boolean;
  demoMode: boolean;
}

export function capabilities(env: Env): Capabilities {
  return {
    xApiConfigured: env.X_BEARER_TOKEN.length > 0,
    claudeConfigured: env.ANTHROPIC_API_KEY.length > 0 && env.ANTHROPIC_MODEL.length > 0,
    mcpConfigured: env.MCP_API_TOKEN.length > 0,
    webhookConfigured: env.X_WEBHOOK_SECRET.length > 0,
    rawArchiveEnabled: env.ENABLE_RAW_ARCHIVE,
    vectorSearchEnabled: env.ENABLE_VECTOR_SEARCH,
    demoMode: env.DEMO_MODE && env.APP_ENV !== "production",
  };
}

export function allowedEmails(env: Env): string[] {
  return env.ALLOWED_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
