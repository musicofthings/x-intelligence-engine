import type { AlertSeverity, ScreeningResult } from "@xie/shared";

/** Alert evaluation (spec §12 stage H, §17). Deterministic + idempotent-friendly. */

export interface AlertDecision {
  shouldAlert: boolean;
  severity: AlertSeverity;
  title: string;
  reason: string;
}

export interface AlertInput {
  screening: ScreeningResult;
  /** Monitor's configured immediate-alert threshold (default 90). */
  alertThreshold: number;
  monitorName: string;
  authorUsername: string | null;
}

export function evaluateAlert(input: AlertInput): AlertDecision {
  const s = input.screening;
  const strategic = s.strategicImportanceScore;
  const shouldAlert = strategic >= input.alertThreshold;

  const severity: AlertSeverity =
    strategic >= 95 ? "critical" : strategic >= 90 ? "high" : strategic >= 75 ? "medium" : "info";

  const author = input.authorUsername ? `@${input.authorUsername}` : "unknown source";
  return {
    shouldAlert,
    severity,
    title: `${s.topic}: ${truncate(s.summary, 80)}`,
    reason: `Strategic importance ${strategic}/100 from ${author} via "${input.monitorName}". ${s.reason}`,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
