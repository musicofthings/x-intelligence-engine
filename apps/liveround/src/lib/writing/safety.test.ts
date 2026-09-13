import { describe, expect, it } from "vitest";
import { checkReply } from "./safety";

describe("safety net", () => {
  it("blocks empty drafts", () => {
    const r = checkReply("   ");
    expect(r.sendable).toBe(false);
    expect(r.warnings[0]?.code).toBe("empty");
  });

  it("warns on engagement bait without blocking", () => {
    const r = checkReply("Agree?");
    expect(r.sendable).toBe(true);
    expect(r.warnings.some((w) => w.code === "engagement_bait")).toBe(true);
    expect(r.warnings.every((w) => w.severity !== "block" || w.code === "empty")).toBe(true);
  });

  it("warns on near-duplicate replies", () => {
    const r = checkReply("The comment is the actual surface area for this.", {
      recentReplies: ["The comment is the actual surface area for this product."],
    });
    expect(r.warnings.some((w) => w.code === "duplicate_reply")).toBe(true);
    expect(r.sendable).toBe(true);
  });

  it("warns on overused links", () => {
    const r = checkReply("See https://example.com/a for the note.", {
      recentLinkHosts: { "example.com": 3 },
      linkReuseMax: 3,
    });
    expect(r.warnings.some((w) => w.code === "link_overuse")).toBe(true);
  });
});
