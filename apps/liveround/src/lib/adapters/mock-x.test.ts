import { describe, expect, it } from "vitest";
import { mockXAdapter } from "./mock-x";
import type { Campaign } from "@/lib/types";

const campaign: Campaign = {
  id: "cmp_1",
  userId: "usr_1",
  name: "Primary",
  actingAccountId: "soc_1",
  building: "a live engagement cockpit",
  reaching: "founders in public",
  strategyX: "reply in living threads",
  strategyReddit: "",
  filterDoc: "dream post: someone asking how to join live conversations",
  searchRules: [{ query: "live conversations", source: "generated" }],
  subreddits: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("mock X adapter", () => {
  it("returns fresh posts and has no write methods", async () => {
    const posts = await mockXAdapter.discover({
      campaign,
      sinceIso: new Date(Date.now() - 86400000).toISOString(),
      limit: 8,
    });
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.network === "x")).toBe(true);
    expect("reply" in mockXAdapter).toBe(false);
    expect("publish" in mockXAdapter).toBe(false);
  });
});
