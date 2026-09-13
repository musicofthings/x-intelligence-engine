import {
  CREDIT_MS_PER_UNIT,
  START_CREDIT_FLOOR,
  type CreditBalance,
  type RoundSession,
  type UserRecord,
} from "@/lib/types";
import { appendLedger, saveUser } from "@/lib/db/store";
import { newId, nowIso } from "@/lib/utils";

export function balanceOf(user: UserRecord): CreditBalance {
  return {
    plan: user.planCredits,
    permanent: user.permanentCredits,
    total: user.planCredits + user.permanentCredits,
  };
}

export function canStart(user: UserRecord): boolean {
  return balanceOf(user).total >= START_CREDIT_FLOOR;
}

/** Minute index for a given live duration. 0 until the first 60s complete. */
export function minuteIndex(liveMs: number): number {
  return Math.floor(Math.max(0, liveMs) / CREDIT_MS_PER_UNIT);
}

/**
 * First charge is minute 1 (after 60s LIVE), not minute 0 on the opening heartbeat.
 * Returns null when nothing new is billable.
 */
export function nextChargeableMinute(liveMs: number, lastTickMinute: number): number | null {
  const completed = minuteIndex(liveMs);
  if (completed <= 0) return null;
  if (completed <= lastTickMinute) return null;
  return completed;
}

export function intervalIdFor(sessionId: string, minute: number): string {
  return `${sessionId}:m${minute}`;
}

/**
 * Spend 1 credit from plan first, then permanent. No-op if paused or already ticked.
 * Idempotent on (sessionId, minute). Charges after each completed LIVE minute.
 */
export async function tickLiveMinute(user: UserRecord, session: RoundSession): Promise<UserRecord> {
  if (session.state !== "live") return user;
  const minute = nextChargeableMinute(session.liveMs, session.lastTickMinute);
  if (minute == null) return user;

  const id = intervalIdFor(session.id, minute);
  const pool = user.planCredits > 0 ? "plan" : "permanent";
  if (user.planCredits <= 0 && user.permanentCredits <= 0) return user;

  const inserted = await appendLedger({
    id: newId("led"),
    userId: user.id,
    sessionId: session.id,
    intervalId: id,
    pool,
    delta: -1,
    reason: "session_live_tick",
    createdAt: nowIso(),
  });
  if (!inserted) return user;

  if (pool === "plan") user.planCredits = Math.max(0, user.planCredits - 1);
  else user.permanentCredits = Math.max(0, user.permanentCredits - 1);
  session.lastTickMinute = minute;
  await saveUser(user);
  return user;
}
