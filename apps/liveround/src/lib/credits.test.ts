import { describe, expect, it } from "vitest";
import { intervalIdFor, minuteIndex } from "./credits";
import { shouldHardStop, shouldIdlePause } from "./session/clock";
import { HARD_CAP_MS, IDLE_PAUSE_MS } from "./types";

describe("credits and session clocks", () => {
  it("does not tick a minute until 60s of LIVE time", () => {
    expect(minuteIndex(0)).toBe(0);
    expect(minuteIndex(59_999)).toBe(0);
    expect(minuteIndex(60_000)).toBe(1);
  });

  it("builds idempotent interval ids", () => {
    expect(intervalIdFor("ses_1", 3)).toBe("ses_1:m3");
  });

  it("pauses after ~5 minutes idle", () => {
    const last = new Date(Date.now() - IDLE_PAUSE_MS).toISOString();
    expect(shouldIdlePause(last)).toBe(true);
    expect(shouldIdlePause(new Date().toISOString())).toBe(false);
  });

  it("hard-caps at 60 minutes of live time", () => {
    expect(shouldHardStop(HARD_CAP_MS)).toBe(true);
    expect(shouldHardStop(HARD_CAP_MS - 1)).toBe(false);
  });
});
