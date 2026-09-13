import { HARD_CAP_MS, IDLE_PAUSE_MS } from "@/lib/types";

export function shouldIdlePause(lastActivityAt: string, now = Date.now()): boolean {
  return now - new Date(lastActivityAt).getTime() >= IDLE_PAUSE_MS;
}

export function shouldHardStop(liveMs: number): boolean {
  return liveMs >= HARD_CAP_MS;
}
