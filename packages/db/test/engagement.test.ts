import { describe, it, expect } from "vitest";
import { createTestDb } from "./adapter.js";
import { Repositories } from "../src/repositories.js";
import type { Clock, IdGen } from "../src/d1.js";
import type { NormalizedXPost } from "@xie/shared";

let seq = 0;
let nowIso = "2026-08-07T12:00:00.000Z";
const clock: Clock = { nowIso: () => nowIso };
const ids: IdGen = { next: (p) => `${p}_${(seq++).toString().padStart(4, "0")}` };

function repos() {
  const { d1, raw } = createTestDb();
  seq = 0;
  nowIso = "2026-08-07T12:00:00.000Z";
  return { repo: new Repositories(d1, clock, ids), d1, raw };
}

function post(over: Partial<NormalizedXPost> = {}): NormalizedXPost {
  return {
    network: "x",
    xPostId: "1800000000000000001",
    authorId: "42",
    authorUsername: "alice",
    authorName: "Alice",
    text: "Long-read assembly benchmark results are out.",
    lang: "en",
    createdAt: "2026-08-07T11:30:00Z",
    conversationId: "1800000000000000001",
    inReplyToUserId: null,
    url: "https://x.com/alice/status/1800000000000000001",
    metrics: { likeCount: 50, repostCount: 2, replyCount: 4, quoteCount: 0, bookmarkCount: 1, impressionCount: 900 },
    raw: {},
    ...over,
  };
}

describe("voice profiles", () => {
  it("creates, reads, updates and deletes", async () => {
    const { repo } = repos();
    const id = await repo.engage.createVoiceProfile({
      name: "Analyst", tone: "dry", do: ["cite a number"], dont: ["no emoji"], maxChars: 240,
    });
    const v = (await repo.engage.getVoiceProfile(id))!;
    expect(v.name).toBe("Analyst");
    expect(v.do).toEqual(["cite a number"]);
    expect(v.maxChars).toBe(240);

    await repo.engage.updateVoiceProfile(id, { tone: "warmer", sampleReplies: ["a", "b"] });
    const after = (await repo.engage.getVoiceProfile(id))!;
    expect(after.tone).toBe("warmer");
    expect(after.sampleReplies).toEqual(["a", "b"]);
    expect(after.name).toBe("Analyst"); // untouched fields survive

    await repo.engage.deleteVoiceProfile(id);
    expect(await repo.engage.getVoiceProfile(id)).toBeNull();
  });

  it("applies sane defaults", async () => {
    const { repo } = repos();
    const v = (await repo.engage.getVoiceProfile(await repo.engage.createVoiceProfile({ name: "Bare" })))!;
    expect(v.maxChars).toBe(260);
    expect(v.do).toEqual([]);
    expect(v.tone).toContain("direct");
  });
});

describe("campaigns", () => {
  it("creates a campaign and links monitors", async () => {
    const { repo } = repos();
    const campaignId = await repo.engage.createCampaign({
      name: "Genomics", slug: "genomics", networks: ["x", "reddit"], goalRepliesPerDay: 15,
    });
    const monitorId = await repo.createMonitor({ name: "M", slug: "m", type: "recent_search" });
    await repo.engage.linkMonitor(campaignId, monitorId);

    const c = (await repo.engage.getCampaign(campaignId))!;
    expect(c.networks).toEqual(["x", "reddit"]);
    expect(c.goalRepliesPerDay).toBe(15);
    expect(await repo.engage.campaignMonitorIds(campaignId)).toEqual([monitorId]);
    expect((await repo.engage.listCampaigns())[0]?.monitorCount).toBe(1);
  });

  it("is idempotent when the same monitor is linked twice", async () => {
    const { repo } = repos();
    const cid = await repo.engage.createCampaign({ name: "C", slug: "c" });
    const mid = await repo.createMonitor({ name: "M", slug: "m", type: "recent_search" });
    await repo.engage.linkMonitor(cid, mid);
    await repo.engage.linkMonitor(cid, mid);
    expect(await repo.engage.campaignMonitorIds(cid)).toHaveLength(1);
  });

  it("detaches a network without deleting the campaign or its other monitors", async () => {
    const { repo } = repos();
    const cid = await repo.engage.createCampaign({ name: "C", slug: "c", networks: ["x", "reddit"] });
    const xMon = await repo.createMonitor({ name: "X", slug: "x-mon", type: "recent_search" });
    const rMon = await repo.createMonitor({ name: "R", slug: "r-mon", type: "recent_search", network: "reddit" });
    await repo.engage.linkMonitor(cid, xMon);
    await repo.engage.linkMonitor(cid, rMon);

    const unlinked = await repo.engage.detachNetwork(cid, "reddit");
    expect(unlinked).toBe(1);
    expect(await repo.engage.campaignMonitorIds(cid)).toEqual([xMon]);
    const c = (await repo.engage.getCampaign(cid))!;
    expect(c.networks).toEqual(["x"]);
    // The Reddit monitor itself survives — it may belong to other campaigns.
    expect(await repo.getMonitor(rMon)).not.toBeNull();
  });

  it("cascades monitor links when the campaign is deleted", async () => {
    const { repo, raw } = repos();
    const cid = await repo.engage.createCampaign({ name: "C", slug: "c" });
    const mid = await repo.createMonitor({ name: "M", slug: "m", type: "recent_search" });
    await repo.engage.linkMonitor(cid, mid);
    await repo.engage.deleteCampaign(cid);
    const n = raw.prepare("SELECT COUNT(*) AS n FROM campaign_monitors").get() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe("reddit posts through the shared pipeline", () => {
  it("stores a reddit post alongside x posts without id collision", async () => {
    const { repo } = repos();
    await repo.upsertPost(post());
    const { id, isNew } = await repo.upsertPost(post({
      network: "reddit", xPostId: "t3_abc", authorUsername: "bob",
      url: "https://www.reddit.com/r/bioinformatics/comments/abc/x/",
    }));
    expect(isNew).toBe(true);
    const stored = (await repo.getPost(id))!;
    expect(stored.network).toBe("reddit");
    expect(stored.xPostId).toBe("t3_abc");
  });

  it("defaults legacy posts with no network to x", async () => {
    const { repo } = repos();
    const { id } = await repo.upsertPost({ ...post(), network: undefined });
    expect((await repo.getPost(id))!.network).toBe("x");
  });

  it("round-trips reddit monitor config", async () => {
    const { repo } = repos();
    const id = await repo.createMonitor({
      name: "Bioinformatics", slug: "bioinf", type: "recent_search", network: "reddit",
      subreddits: ["bioinformatics", "genomics"], keywords: ["ctDNA", "long read"],
    });
    const m = (await repo.getMonitor(id))!;
    expect(m.network).toBe("reddit");
    expect(m.subreddits).toEqual(["bioinformatics", "genomics"]);
    expect(m.keywords).toEqual(["ctDNA", "long read"]);
  });

  it("defaults monitors created before 0007 to the x network with no reddit config", async () => {
    const { repo } = repos();
    const m = (await repo.getMonitor((await repo.listMonitors())[0]!.id))!;
    expect(m.network).toBe("x");
    expect(m.subreddits).toEqual([]);
    expect(m.keywords).toEqual([]);
  });
});

describe("drafts and sends", () => {
  async function seeded() {
    const { repo, raw } = repos();
    const { id: postId } = await repo.upsertPost(post());
    const draftId = await repo.engage.createDraft({
      postId, campaignId: null, voiceProfileId: null, body: "A concrete reply.", source: "ai",
    });
    return { repo, raw, postId, draftId };
  }

  it("creates and edits a draft", async () => {
    const { repo, postId, draftId } = await seeded();
    expect((await repo.engage.getDraft(draftId))!.status).toBe("draft");
    await repo.engage.updateDraftBody(draftId, "An edited reply.");
    expect((await repo.engage.getDraft(draftId))!.body).toBe("An edited reply.");
    expect(await repo.engage.listDraftsForPost(postId)).toHaveLength(1);
  });

  it("refuses to edit a draft that is already sent", async () => {
    const { repo, draftId } = await seeded();
    await repo.engage.setDraftStatus(draftId, "sent");
    await repo.engage.updateDraftBody(draftId, "too late");
    expect((await repo.engage.getDraft(draftId))!.body).toBe("A concrete reply.");
  });

  it("claims a send exactly once", async () => {
    const { repo, postId, draftId } = await seeded();
    const claim = { draftId, postId, campaignId: null, network: "x" as const, body: "A concrete reply." };
    const first = await repo.engage.claimSend("reply:1", claim);
    const second = await repo.engage.claimSend("reply:1", claim);
    expect(first).toBeTruthy();
    expect(second).toBeNull(); // a retry must NOT reach the X API
  });

  it("records the upstream id on success", async () => {
    const { repo, postId, draftId } = await seeded();
    const claimId = (await repo.engage.claimSend("reply:2", {
      draftId, postId, campaignId: null, network: "x", body: "b",
    }))!;
    await repo.engage.recordSendResult(claimId, "999");
    expect((await repo.engage.getSentReplyByKey("reply:2"))!.externalReplyId).toBe("999");
  });

  it("releases an unfulfilled claim so the analyst can retry", async () => {
    const { repo, postId, draftId } = await seeded();
    const claimId = (await repo.engage.claimSend("reply:3", {
      draftId, postId, campaignId: null, network: "x", body: "b",
    }))!;
    await repo.engage.releaseSend(claimId);
    expect(await repo.engage.getSentReplyByKey("reply:3")).toBeNull();
    expect(await repo.engage.claimSend("reply:3", { draftId, postId, campaignId: null, network: "x", body: "b" })).toBeTruthy();
  });

  it("never releases a claim that already posted", async () => {
    const { repo, postId, draftId } = await seeded();
    const claimId = (await repo.engage.claimSend("reply:4", {
      draftId, postId, campaignId: null, network: "x", body: "b",
    }))!;
    await repo.engage.recordSendResult(claimId, "555");
    await repo.engage.releaseSend(claimId);
    expect(await repo.engage.getSentReplyByKey("reply:4")).not.toBeNull();
  });

  it("returns recent bodies newest-first and counts sends in a window", async () => {
    const { repo, postId } = await seeded();
    nowIso = "2026-08-07T10:00:00.000Z";
    await repo.engage.claimSend("k1", { draftId: null, postId, campaignId: null, network: "x", body: "older" });
    nowIso = "2026-08-07T12:00:00.000Z";
    await repo.engage.claimSend("k2", { draftId: null, postId, campaignId: null, network: "x", body: "newer" });

    expect(await repo.engage.recentSentBodies(10)).toEqual(["newer", "older"]);
    expect(await repo.engage.sentCountSince("2026-08-07T11:00:00.000Z")).toBe(1);
    expect(await repo.engage.sentCountSince("2026-08-07T00:00:00.000Z")).toBe(2);
  });

  it("counts link hosts across sent replies in the window", async () => {
    const { repo, postId } = await seeded();
    await repo.engage.claimSend("l1", { draftId: null, postId, campaignId: null, network: "x", body: "see https://www.example.com/a" });
    await repo.engage.claimSend("l2", { draftId: null, postId, campaignId: null, network: "x", body: "and http://example.com/b?q=1" });
    await repo.engage.claimSend("l3", { draftId: null, postId, campaignId: null, network: "x", body: "no links here" });
    expect(await repo.engage.recentLinkHosts("2026-08-01T00:00:00.000Z")).toEqual({ "example.com": 2 });
  });
});

describe("sessions and events", () => {
  async function seeded() {
    const { repo } = repos();
    const a = await repo.upsertPost(post());
    const b = await repo.upsertPost(post({ xPostId: "1800000000000000002", authorUsername: "bob" }));
    return { repo, postA: a.id, postB: b.id };
  }

  it("tracks live counters and freezes them on end", async () => {
    const { repo, postA, postB } = await seeded();
    const sid = await repo.engage.startSession(null, 5);
    await repo.engage.recordEvent({ sessionId: sid, campaignId: null, postId: postA, kind: "replied" });
    await repo.engage.recordEvent({ sessionId: sid, campaignId: null, postId: postB, kind: "skipped" });

    const live = await repo.engage.sessionLiveStats(sid);
    expect(live).toMatchObject({ reviewed: 2, replied: 1, skipped: 1 });

    nowIso = "2026-08-07T12:15:00.000Z";
    const ended = (await repo.engage.endSession(sid))!;
    expect(ended.repliesSent).toBe(1);
    expect(ended.skipped).toBe(1);
    expect(ended.reviewed).toBe(2);
    expect(ended.durationSeconds).toBe(900);
    expect(ended.endedAt).toBe("2026-08-07T12:15:00.000Z");
  });

  it("does not re-close an already-ended session", async () => {
    const { repo } = repos();
    const sid = await repo.engage.startSession(null, 5);
    nowIso = "2026-08-07T12:10:00.000Z";
    const first = (await repo.engage.endSession(sid))!;
    nowIso = "2026-08-07T13:00:00.000Z";
    const second = (await repo.engage.endSession(sid))!;
    expect(second.endedAt).toBe(first.endedAt);
    expect(second.durationSeconds).toBe(600);
  });

  it("ignores a duplicate event for the same session, post and kind", async () => {
    const { repo, postA } = await seeded();
    const sid = await repo.engage.startSession(null, 5);
    await repo.engage.recordEvent({ sessionId: sid, campaignId: null, postId: postA, kind: "skipped" });
    await repo.engage.recordEvent({ sessionId: sid, campaignId: null, postId: postA, kind: "skipped" });
    expect((await repo.engage.sessionLiveStats(sid)).skipped).toBe(1);
  });
});

describe("engagement signals", () => {
  it("nets engagements against skips per author and topic", async () => {
    const { repo } = repos();
    const alice = (await repo.upsertPost(post({ authorUsername: "alice" }))).id;
    const bob = (await repo.upsertPost(post({ xPostId: "1800000000000000009", authorUsername: "bob" }))).id;
    for (const [id, topic] of [[alice, "Genomics"], [bob, "Genomics"]] as const) {
      await repo.saveScreening(id, "anthropic", "m", "v1", {
        relevanceScore: 80, noveltyScore: 50, credibilityScore: 70, strategicImportanceScore: 80,
        topic, subtopic: "", requiresFollowup: false, reason: "", summary: "", recommendedAction: "",
        entities: [], risks: [], evidence: [],
      }, { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }, {});
    }

    const s1 = await repo.engage.startSession(null, 5);
    const s2 = await repo.engage.startSession(null, 5);
    await repo.engage.recordEvent({ sessionId: s1, campaignId: null, postId: alice, kind: "replied" });
    await repo.engage.recordEvent({ sessionId: s2, campaignId: null, postId: alice, kind: "engaged" });
    await repo.engage.recordEvent({ sessionId: s1, campaignId: null, postId: bob, kind: "skipped" });

    const sig = await repo.engage.engagementSignals(null);
    expect(sig.authorAffinity.alice).toBe(2);
    expect(sig.authorAffinity.bob).toBe(-1);
    expect(sig.topicAffinity.genomics).toBe(1); // +2 alice, -1 bob
    expect(sig.totalEngaged).toBe(2);
    expect(sig.totalSkipped).toBe(1);
  });

  it("returns empty signals with no history", async () => {
    const { repo } = repos();
    expect(await repo.engage.engagementSignals(null)).toEqual({
      authorAffinity: {}, topicAffinity: {}, totalEngaged: 0, totalSkipped: 0,
    });
  });
});

describe("engage candidates", () => {
  async function seeded() {
    const { repo } = repos();
    const monitorId = await repo.createMonitor({ name: "Genomics feed", slug: "gf", type: "recent_search" });
    const { id: postId } = await repo.upsertPost(post());
    await repo.recordMatch(postId, monitorId, "monitor");
    await repo.saveScreening(postId, "anthropic", "m", "v1", {
      relevanceScore: 70, noveltyScore: 50, credibilityScore: 60, strategicImportanceScore: 85,
      topic: "genomics", subtopic: "", requiresFollowup: false, reason: "", summary: "A summary.",
      recommendedAction: "", entities: [], risks: [], evidence: [],
    }, { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }, {});
    return { repo, postId, monitorId };
  }

  it("surfaces a screened post with its monitor names and draft count", async () => {
    const { repo, postId } = await seeded();
    await repo.engage.createDraft({ postId, campaignId: null, voiceProfileId: null, body: "d" });
    const [c] = await repo.engage.engageCandidates({ minStrategic: 40 });
    expect(c?.postId).toBe(postId);
    expect(c?.strategicScore).toBe(85);
    expect(c?.summary).toBe("A summary.");
    expect(c?.monitorNames).toBe("Genomics feed");
    expect(c?.draftCount).toBe(1);
    expect(c?.hasReply).toBe(0);
  });

  it("excludes dismissed and archived posts", async () => {
    const { repo, postId } = await seeded();
    await repo.patchState(postId, { isDismissed: true });
    expect(await repo.engage.engageCandidates({ minStrategic: 40 })).toHaveLength(0);
  });

  it("excludes posts below the strategic threshold", async () => {
    const { repo } = await seeded();
    expect(await repo.engage.engageCandidates({ minStrategic: 90 })).toHaveLength(0);
  });

  it("filters by network and by campaign membership", async () => {
    const { repo, postId, monitorId } = await seeded();
    expect(await repo.engage.engageCandidates({ network: "reddit" })).toHaveLength(0);
    expect(await repo.engage.engageCandidates({ network: "x" })).toHaveLength(1);

    const cid = await repo.engage.createCampaign({ name: "C", slug: "c" });
    expect(await repo.engage.engageCandidates({ campaignId: cid })).toHaveLength(0);
    await repo.engage.linkMonitor(cid, monitorId);
    expect(await repo.engage.engageCandidates({ campaignId: cid })).toHaveLength(1);
    expect((await repo.engage.engageCandidates({ campaignId: cid }))[0]?.postId).toBe(postId);
  });

  it("marks posts that already have a reply", async () => {
    const { repo, postId } = await seeded();
    await repo.engage.claimSend("k", { draftId: null, postId, campaignId: null, network: "x", body: "b" });
    expect((await repo.engage.engageCandidates({}))[0]?.hasReply).toBe(1);
  });
});

describe("oauth storage", () => {
  it("upserts by account key and preserves an existing refresh token", async () => {
    const { repo } = repos();
    await repo.engage.saveOAuthToken({
      accountKey: "x:default", network: "x", externalUserId: "7", username: "alice",
      accessTokenEnc: "enc-a", refreshTokenEnc: "enc-r", scope: "tweet.write", expiresAt: "2026-08-07T14:00:00Z",
    });
    // A refresh response that omits a new refresh token must not wipe the stored one.
    await repo.engage.saveOAuthToken({
      accountKey: "x:default", network: "x", externalUserId: "7", username: "alice",
      accessTokenEnc: "enc-a2", refreshTokenEnc: null, scope: "tweet.write", expiresAt: "2026-08-07T16:00:00Z",
    });
    const t = (await repo.engage.getOAuthToken("x:default"))!;
    expect(t.accessTokenEnc).toBe("enc-a2");
    expect(t.refreshTokenEnc).toBe("enc-r");
    expect(t.username).toBe("alice");

    await repo.engage.deleteOAuthToken("x:default");
    expect(await repo.engage.getOAuthToken("x:default")).toBeNull();
  });
});

describe("oauth pkce state", () => {
  it("consumes state exactly once", async () => {
    const { repo } = repos();
    await repo.engage.saveOAuthState("st", "verifier", "https://app/cb");
    expect(await repo.engage.consumeOAuthState("st")).toEqual({
      codeVerifier: "verifier", redirectUri: "https://app/cb",
    });
    expect(await repo.engage.consumeOAuthState("st")).toBeNull();
  });

  it("rejects an expired state and still deletes it", async () => {
    const { repo, raw } = repos();
    await repo.engage.saveOAuthState("old", "v", "https://app/cb");
    nowIso = "2026-08-07T12:20:00.000Z"; // 20 minutes later, TTL is 10
    expect(await repo.engage.consumeOAuthState("old")).toBeNull();
    const n = raw.prepare("SELECT COUNT(*) AS n FROM oauth_states").get() as { n: number };
    expect(n.n).toBe(0);
  });

  it("purges abandoned handshakes", async () => {
    const { repo } = repos();
    await repo.engage.saveOAuthState("a", "v", "u");
    nowIso = "2026-08-07T12:30:00.000Z";
    await repo.engage.saveOAuthState("b", "v", "u");
    expect(await repo.engage.purgeExpiredOAuthStates()).toBe(1);
    expect(await repo.engage.consumeOAuthState("b")).not.toBeNull();
  });

  it("returns null for an unknown state", async () => {
    const { repo } = repos();
    expect(await repo.engage.consumeOAuthState("nope")).toBeNull();
  });
});

describe("maintenance with engagement data", () => {
  it("preserves campaigns, voice profiles and connected accounts across a reset", async () => {
    const { repo } = repos();
    const cid = await repo.engage.createCampaign({ name: "C", slug: "c" });
    const vid = await repo.engage.createVoiceProfile({ name: "V" });
    await repo.engage.saveOAuthToken({
      accountKey: "x:default", network: "x", externalUserId: "7", username: "alice",
      accessTokenEnc: "enc", refreshTokenEnc: null, scope: null, expiresAt: null,
    });
    const { id: postId } = await repo.upsertPost(post());
    await repo.engage.createDraft({ postId, campaignId: cid, voiceProfileId: vid, body: "d" });
    await repo.engage.startSession(cid, 5);

    await repo.resetIntelligence({ resetCheckpoints: true });

    expect(await repo.engage.getCampaign(cid)).not.toBeNull();
    expect(await repo.engage.getVoiceProfile(vid)).not.toBeNull();
    expect(await repo.engage.getOAuthToken("x:default")).not.toBeNull();
    // Post-scoped engagement data goes with the posts.
    expect(await repo.engage.listDraftsForPost(postId)).toHaveLength(0);
    expect(await repo.engage.listSessions()).toHaveLength(0);
  });

  it("reports engagement table counts", async () => {
    const { repo } = repos();
    await repo.engage.createCampaign({ name: "C", slug: "c" });
    const stats = await repo.maintenanceStats();
    expect(stats.campaigns).toBe(1);
    expect(stats.reply_drafts).toBe(0);
    expect(stats.sent_replies).toBe(0);
  });
});
