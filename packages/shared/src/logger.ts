/** Structured JSON logging (spec §35). Redacts secret-bearing fields. */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  service?: string;
  environment?: string;
  request_id?: string;
  job_id?: string;
  monitor_id?: string;
  post_id?: string;
  event?: string;
  duration_ms?: number;
  status?: string | number;
  error_code?: string;
  [key: string]: unknown;
}

/** Keys whose values must never be logged, even if passed in context. */
const SECRET_KEYS = [
  "authorization",
  "x_bearer_token",
  "bearer",
  "anthropic_api_key",
  "api_key",
  "apikey",
  "mcp_api_token",
  "token",
  "secret",
  "password",
  "cookie",
  "x-webhook-secret",
];

function redact(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s))) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface Logger {
  debug(event: string, ctx?: LogContext): void;
  info(event: string, ctx?: LogContext): void;
  warn(event: string, ctx?: LogContext): void;
  error(event: string, ctx?: LogContext): void;
  child(bound: LogContext): Logger;
}

export function createLogger(opts: {
  service: string;
  environment: string;
  level?: LogLevel;
  bound?: LogContext;
  sink?: (line: string) => void;
}): Logger {
  const minLevel = LEVEL_ORDER[opts.level ?? "info"];
  const sink = opts.sink ?? ((line: string) => console.log(line));
  const bound = opts.bound ?? {};

  function emit(level: LogLevel, event: string, ctx?: LogContext): void {
    if (LEVEL_ORDER[level] < minLevel) return;
    const record = redact({
      level,
      // timestamp is injected by callers/host where a deterministic clock exists;
      // here we use ISO now which is acceptable in the runtime (not in workflow scripts).
      timestamp: new Date().toISOString(),
      service: opts.service,
      environment: opts.environment,
      event,
      ...bound,
      ...(ctx ?? {}),
    });
    sink(JSON.stringify(record));
  }

  return {
    debug: (event, ctx) => emit("debug", event, ctx),
    info: (event, ctx) => emit("info", event, ctx),
    warn: (event, ctx) => emit("warn", event, ctx),
    error: (event, ctx) => emit("error", event, ctx),
    child: (extra) =>
      createLogger({ ...opts, bound: { ...bound, ...extra } }),
  };
}
