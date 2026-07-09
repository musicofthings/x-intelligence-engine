import type { Repositories } from "@xie/db";
import type { Env } from "@xie/config";
import type { Logger } from "@xie/shared";

/** Cloudflare bindings + parsed env for the API Worker. */
export interface Bindings {
  DB: D1Database;
  INGEST_QUEUE: Queue;
  SCREENING_QUEUE: Queue;
  RAW_ARCHIVE?: R2Bucket;
  /** Static-assets binding — serves the built SPA (apps/web/dist) for non-API paths. */
  ASSETS: Fetcher;

  // Vars + secrets (strings from the platform).
  APP_ENV: string;
  APP_VERSION: string;
  WEB_ORIGIN: string;
  APP_TIMEZONE: string;
  AUTH_MODE: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
  X_BEARER_TOKEN?: string;
  X_API_BASE_URL?: string;
  X_WEBHOOK_SECRET?: string;
  X_POST_READ_UNIT_COST_USD?: string;
  X_USER_READ_UNIT_COST_USD?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  CLAUDE_INPUT_COST_PER_MILLION?: string;
  CLAUDE_OUTPUT_COST_PER_MILLION?: string;
  MCP_API_TOKEN?: string;
  MCP_ALLOW_MUTATIONS?: string;
  ALERT_WEBHOOK_URL?: string;
  X_DAILY_RESOURCE_BUDGET?: string;
  X_MONTHLY_RESOURCE_BUDGET?: string;
  CLAUDE_DAILY_REQUEST_BUDGET?: string;
  HARD_STOP_ON_BUDGET_EXCEEDED?: string;
  ENABLE_RAW_ARCHIVE?: string;
  ENABLE_VECTOR_SEARCH?: string;
  DEMO_MODE?: string;
  LOG_LEVEL?: string;
}

/** Per-request derived context stored on Hono `c.var`. */
export interface AppVars {
  env: Env;
  repo: Repositories;
  logger: Logger;
  requestId: string;
  actor: string | null;
}

export type HonoEnv = { Bindings: Bindings; Variables: AppVars };
