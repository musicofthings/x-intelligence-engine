/** Typed error taxonomy (spec §34). Internal detail is actionable; public message is safe. */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "RATE_LIMIT_ERROR"
  | "X_API_ERROR"
  | "CLAUDE_API_ERROR"
  | "DATABASE_ERROR"
  | "QUEUE_ERROR"
  | "BUDGET_EXCEEDED"
  | "CONFIGURATION_ERROR"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

const PUBLIC_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  RATE_LIMIT_ERROR: 429,
  X_API_ERROR: 502,
  CLAUDE_API_ERROR: 502,
  DATABASE_ERROR: 500,
  QUEUE_ERROR: 500,
  BUDGET_EXCEEDED: 429,
  CONFIGURATION_ERROR: 500,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

const SAFE_PUBLIC_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Request validation failed.",
  AUTHENTICATION_ERROR: "Authentication required.",
  AUTHORIZATION_ERROR: "You are not authorized to perform this action.",
  RATE_LIMIT_ERROR: "Rate limit exceeded. Please retry later.",
  X_API_ERROR: "Upstream X API error.",
  CLAUDE_API_ERROR: "Upstream Claude API error.",
  DATABASE_ERROR: "A database error occurred.",
  QUEUE_ERROR: "A queue processing error occurred.",
  BUDGET_EXCEEDED: "A configured budget has been exceeded.",
  CONFIGURATION_ERROR: "Server configuration error.",
  NOT_FOUND: "Resource not found.",
  INTERNAL_ERROR: "An internal error occurred.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Extra structured, log-only context. Never returned to unauthenticated clients. */
  readonly detail?: Record<string, unknown>;
  /** Field-level validation issues, safe to surface publicly. */
  readonly issues?: { path: string; message: string }[];

  constructor(
    code: ErrorCode,
    message?: string,
    opts?: { detail?: Record<string, unknown>; issues?: { path: string; message: string }[]; cause?: unknown },
  ) {
    super(message ?? SAFE_PUBLIC_MESSAGE[code]);
    this.name = "AppError";
    this.code = code;
    if (opts?.detail) this.detail = opts.detail;
    if (opts?.issues) this.issues = opts.issues;
    if (opts?.cause) (this as { cause?: unknown }).cause = opts.cause;
  }

  get status(): number {
    return PUBLIC_STATUS[this.code];
  }

  /** Shape returned to clients — never leaks `detail` or stack traces. */
  toPublic(requestId?: string): {
    error: { code: ErrorCode; message: string; issues?: { path: string; message: string }[]; request_id?: string };
  } {
    return {
      error: {
        code: this.code,
        message: SAFE_PUBLIC_MESSAGE[this.code],
        ...(this.issues ? { issues: this.issues } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Normalize any thrown value into an AppError for consistent handling. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new AppError("INTERNAL_ERROR", message, { cause: e });
}
