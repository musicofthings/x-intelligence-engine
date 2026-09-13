import { describe, expect, it } from "vitest";
import { classifyVolume } from "./search";
import { volumeForQuery } from "./volume";

describe("search-rule volume", () => {
  it("bands quiet / ok / noisy", () => {
    expect(classifyVolume(0)).toBe("quiet");
    expect(classifyVolume(4)).toBe("quiet");
    expect(classifyVolume(20)).toBe("ok");
    expect(classifyVolume(80)).toBe("noisy");
  });

  it("uses the mock corpus when X is not configured", async () => {
    const report = await volumeForQuery("live conversations");
    expect(report.query).toBe("live conversations");
    expect(report.retryable).toBe(false);
    expect(["quiet", "ok", "noisy"]).toContain(report.band);
    expect(report.message).toMatch(/mock/i);
    expect(report.message).not.toContain("live conversations");
  });
});
