import { describe, expect, it } from "vitest";
import { nextSlot, normalizePosting, slotsForDay } from "./schedule";
import type { PostingSettings } from "@/lib/types";

const settings: PostingSettings = {
  userId: "usr_1",
  postsPerDay: 3,
  windowStart: "09:00",
  windowEnd: "17:00",
  timezone: "UTC",
};

describe("post idea schedule", () => {
  it("caps posts per day at 10", () => {
    expect(normalizePosting({ ...settings, postsPerDay: 99 }).postsPerDay).toBe(10);
  });

  it("spreads slots through the window", () => {
    const slots = slotsForDay(settings, Date.UTC(2026, 8, 13, 0, 0), "seed");
    expect(slots).toHaveLength(3);
    const start = Date.parse("2026-09-13T09:00:00.000Z");
    const end = Date.parse("2026-09-13T17:00:00.000Z");
    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(start);
      expect(slot).toBeLessThanOrEqual(end);
    }
    expect(slots[2]! - slots[0]!).toBeGreaterThan(60 * 60 * 1000);
  });

  it("picks a future unused slot", () => {
    const now = Date.parse("2026-09-13T08:00:00.000Z");
    const iso = nextSlot(settings, [], now, "usr_1");
    expect(Date.parse(iso)).toBeGreaterThan(now);
  });
});
