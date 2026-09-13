import { describe, expect, it } from "vitest";
import { audiencePhrase, productPhrase, thinkForMe } from "./draft";
import { charLimitFor } from "@/lib/send/compose";
import type { Campaign, SocialPost } from "@/lib/types";
import { generateDraft } from "./draft";

const post: SocialPost = {
  network: "x",
  adapter: "mock_x",
  id: "1",
  url: "https://x.com/a/status/1",
  authorId: "a",
  authorHandle: "a",
  authorName: "A",
  body: "Anyone else finding that inbound is mostly people who saw a comment, not a launch post?",
  createdAt: new Date().toISOString(),
  conversationId: "1",
  metrics: { likes: 0, replies: 0, reposts: 0, saves: 0, comments: 0 },
  media: [],
};

const campaign: Campaign = {
  id: "cmp_1",
  userId: "usr_1",
  name: "Primary",
  actingAccountId: "acc_1",
  building: "A cockpit for founders who reply in public.",
  reaching: "Founders who already hang out in live product threads.",
  strategyX: "",
  strategyReddit: "",
  filterDoc: "",
  searchRules: [],
  subreddits: [],
  minFollowers: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("think-for-me phrases", () => {
  it("strips leading articles and trailing for/who clauses", () => {
    expect(productPhrase("A cockpit for founders who reply in public.")).toBe("cockpit");
    expect(audiencePhrase("Founders who already hang out in live product threads.")).toBe("Founders");
  });

  it("does not emit a first-word search rule of “A”", async () => {
    const thought = await thinkForMe(campaign.building, campaign.reaching);
    expect(thought.searchRules.map((r) => r.query)).not.toContain('"looking for" A');
    expect(thought.searchRules.some((r) => r.query.includes("cockpit"))).toBe(true);
    expect(thought.filterDoc).not.toMatch(/someone in Founders who already/);
    expect(thought.filterDoc).toMatch(/Founders describing a live problem that cockpit/);
  });
});

describe("heuristic drafts", () => {
  it("leaves room to edit on X", async () => {
    const draft = await generateDraft({
      post,
      campaign,
      voice: { bio: "", writingNotes: "", replyLength: 50, samplePosts: [] },
      writing: { userId: "usr_1", bio: "", writingNotes: "", replyLength: 50 },
      job: "draft",
    });
    const limit = charLimitFor("x");
    expect(draft.length).toBeGreaterThan(40);
    expect(limit - draft.length).toBeGreaterThanOrEqual(30);
  });
});
