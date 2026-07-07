/** Cloudflare bindings for the pipeline worker. */
export interface Bindings {
  DB: D1Database;
  INGEST_QUEUE: Queue;
  SCREENING_QUEUE: Queue;
  RAW_ARCHIVE?: R2Bucket;

  APP_ENV: string;
  APP_VERSION: string;
  APP_TIMEZONE: string;
  X_BEARER_TOKEN?: string;
  X_API_BASE_URL?: string;
  X_POST_READ_UNIT_COST_USD?: string;
  X_USER_READ_UNIT_COST_USD?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  CLAUDE_INPUT_COST_PER_MILLION?: string;
  CLAUDE_OUTPUT_COST_PER_MILLION?: string;
  ALERT_WEBHOOK_URL?: string;
  X_DAILY_RESOURCE_BUDGET?: string;
  X_MONTHLY_RESOURCE_BUDGET?: string;
  CLAUDE_DAILY_REQUEST_BUDGET?: string;
  HARD_STOP_ON_BUDGET_EXCEEDED?: string;
  ENABLE_RAW_ARCHIVE?: string;
  LOG_LEVEL?: string;
}

/** Ingest queue message (spec §27). */
export interface IngestMessage {
  schema_version: 1;
  event_id: string;
  source_type: "recent_search" | "user_timeline" | "x_list" | "webhook";
  monitor_id: string;
  received_at: string;
  payload: Record<string, unknown>;
}

/** Screening queue message (spec §27). */
export interface ScreeningMessage {
  schema_version: 1;
  job_key: string;
  post_id: string;
  monitor_id: string;
  prompt_version: string;
  force?: boolean;
  kind?: "digest";
}
