/** Monitor scheduling (spec §29). A 15-min dispatcher tick does not run every monitor. */

export interface DueMonitorInput {
  enabled: boolean;
  pollIntervalMinutes: number;
  lastRunAt: string | null;
  /** True if a run is already in flight (prevents overlap, spec §29). */
  running?: boolean;
}

/**
 * Determine whether a monitor is due at `nowMs`. Disabled or in-flight monitors are
 * never due. A monitor that never ran is due immediately.
 */
export function isMonitorDue(m: DueMonitorInput, nowMs: number): boolean {
  if (!m.enabled) return false;
  if (m.running) return false;
  if (!m.lastRunAt) return true;
  const last = Date.parse(m.lastRunAt);
  if (Number.isNaN(last)) return true;
  const intervalMs = Math.max(1, m.pollIntervalMinutes) * 60_000;
  return nowMs - last >= intervalMs;
}

/**
 * Convert a local wall-clock time in a fixed offset timezone to the UTC hour/minute
 * for cron scheduling (spec §18). Default use: 08:00 Asia/Kolkata (UTC+5:30).
 * Returns minutes-since-midnight UTC.
 */
export function localTimeToUtcMinutes(localHour: number, localMinute: number, tzOffsetMinutes: number): number {
  const totalLocal = localHour * 60 + localMinute;
  let utc = totalLocal - tzOffsetMinutes;
  utc = ((utc % 1440) + 1440) % 1440;
  return utc;
}

/** Asia/Kolkata is a fixed UTC+5:30 offset (no DST). */
export const ASIA_KOLKATA_OFFSET_MINUTES = 330;
