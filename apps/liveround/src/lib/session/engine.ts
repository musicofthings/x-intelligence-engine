import { FRESHNESS_MS, type Campaign, type InboxCard, type Network, type RoundSession, type SessionSnapshot, type SocialPost } from "@/lib/types";
import { shouldHardStop, shouldIdlePause } from "./clock";
import { adapterFor } from "@/lib/adapters";
import { generateDraft } from "@/lib/ai/draft";
import { SCORE_THRESHOLD, rankCards, scorePost } from "@/lib/ai/score";
import { balanceOf, canStart, tickLiveMinute } from "@/lib/credits";
import {
  activeSessionForUser,
  getAccount,
  getCampaign,
  getUserById,
  getWriting,
  isBlocked,
  listAccounts,
  listCards,
  listLogs,
  listUserCards,
  liveSessionForAccount,
  rememberSeen,
  saveAccount,
  saveCard,
  saveSession,
  wasSeen,
} from "@/lib/db/store";
import { anthropicConfigured, redditConfigured, xConfigured } from "@/lib/env";
import { newId, nowIso } from "@/lib/utils";

export { shouldHardStop, shouldIdlePause } from "./clock";

export async function snapshotFor(userId: string): Promise<SessionSnapshot> {
  const user = await getUserById(userId);
  if (!user) throw new Error("Unknown user");
  const session = await activeSessionForUser(userId);
  const campaign = session ? await getCampaign(session.campaignId) : null;
  const acting = session ? await getAccount(session.actingAccountId) : (await listAccounts(userId))[0] ?? null;
  const cards = session ? rankCards(await listCards(session.id)) : [];
  const current = cards.find((c) => c.status === "new") ?? null;
  const queue = cards.filter((c) => c.status === "new" && c.id !== current?.id);
  return {
    session,
    campaign,
    acting,
    current,
    queue,
    credits: balanceOf(user),
    xConfigured: xConfigured(),
    redditConfigured: redditConfigured(),
    anthropicConfigured: anthropicConfigured(),
  };
}

export async function startRound(input: {
  userId: string;
  campaignId: string;
  networks: Network[];
}): Promise<SessionSnapshot> {
  const user = await getUserById(input.userId);
  if (!user) throw new Error("Unknown user");
  if (!canStart(user)) throw new Error("Need a few credits to start a round.");
  const campaign = await getCampaign(input.campaignId);
  if (!campaign || campaign.userId !== input.userId) throw new Error("Campaign not found");
  const existing = await activeSessionForUser(input.userId);
  if (existing && existing.state !== "stopped") {
    if (existing.state !== "live") {
      existing.state = "live";
      existing.pausedAt = null;
      existing.lastActivityAt = nowIso();
      await saveSession(existing);
    }
    return snapshotFor(input.userId);
  }
  const mutex = await liveSessionForAccount(campaign.actingAccountId);
  if (mutex) throw new Error("This social account already has a live round.");
  const now = nowIso();
  const session: RoundSession = {
    id: newId("ses"),
    userId: input.userId,
    campaignId: campaign.id,
    actingAccountId: campaign.actingAccountId,
    networks: input.networks.length ? input.networks : ["x"],
    state: "live",
    startedAt: now,
    pausedAt: null,
    stoppedAt: null,
    liveMs: 0,
    lastActivityAt: now,
    lastHeartbeatAt: now,
    repliesCount: 0,
    queueCount: 0,
    lastTickMinute: -1,
  };
  await saveSession(session);
  const acting = await getAccount(campaign.actingAccountId);
  if (acting) {
    acting.activeSessionId = session.id;
    await saveAccount(acting);
  }
  await scanAndOffer(session, campaign);
  return snapshotFor(input.userId);
}

export async function pauseRound(userId: string, reason: "idle" | "credits" | "user" = "user"): Promise<SessionSnapshot> {
  const session = await activeSessionForUser(userId);
  if (!session || session.state === "stopped") return snapshotFor(userId);
  session.state = reason === "credits" ? "credit_pause" : reason === "idle" ? "idle_pause" : "idle_pause";
  session.pausedAt = nowIso();
  await saveSession(session);
  return snapshotFor(userId);
}

export async function resumeRound(userId: string): Promise<SessionSnapshot> {
  const user = await getUserById(userId);
  if (!user) throw new Error("Unknown user");
  if (balanceOf(user).total <= 0) return pauseRound(userId, "credits");
  const session = await activeSessionForUser(userId);
  if (!session || session.state === "stopped") throw new Error("No round to resume");
  session.state = "live";
  session.pausedAt = null;
  session.lastActivityAt = nowIso();
  await saveSession(session);
  return snapshotFor(userId);
}

export async function stopRound(userId: string): Promise<SessionSnapshot> {
  const session = await activeSessionForUser(userId);
  if (!session) return snapshotFor(userId);
  session.state = "stopped";
  session.stoppedAt = nowIso();
  await saveSession(session);
  const acting = await getAccount(session.actingAccountId);
  if (acting && acting.activeSessionId === session.id) {
    acting.activeSessionId = null;
    await saveAccount(acting);
  }
  return snapshotFor(userId);
}

export async function heartbeat(userId: string, elapsedMs: number, activity = false): Promise<SessionSnapshot> {
  const user = await getUserById(userId);
  if (!user) throw new Error("Unknown user");
  const session = await activeSessionForUser(userId);
  if (!session) return snapshotFor(userId);
  session.lastHeartbeatAt = nowIso();
  if (activity) session.lastActivityAt = nowIso();

  if (session.state === "live") {
    session.liveMs += Math.max(0, Math.min(elapsedMs, 15_000));
    await tickLiveMinute(user, session);
    const fresh = await getUserById(userId);
    if (fresh && fresh.planCredits + fresh.permanentCredits <= 0) {
      session.state = "credit_pause";
      session.pausedAt = nowIso();
    } else if (shouldHardStop(session.liveMs)) {
      session.state = "stopped";
      session.stoppedAt = nowIso();
    } else if (shouldIdlePause(session.lastActivityAt)) {
      session.state = "idle_pause";
      session.pausedAt = nowIso();
    } else {
      const campaign = await getCampaign(session.campaignId);
      if (campaign) await scanAndOffer(session, campaign);
    }
  }
  await saveSession(session);
  return snapshotFor(userId);
}

async function scanAndOffer(session: RoundSession, campaign: Campaign): Promise<void> {
  if (session.state !== "live") return;
  const existing = await listCards(session.id);
  const open = existing.filter((c) => c.status === "new");
  if (open.length >= 6) {
    session.queueCount = open.length;
    return;
  }
  const since = new Date(Date.now() - FRESHNESS_MS).toISOString();
  const passed = (await listUserCards(session.userId))
    .filter((c) => c.status === "passed")
    .map((c) => c.post.body);
  const logs = await listLogs(session.userId);
  const writing = await getWriting(session.userId);
  const acting = await getAccount(session.actingAccountId);
  const discovered: SocialPost[] = [];
  for (const network of session.networks) {
    const adapter = adapterFor(network);
    discovered.push(...(await adapter.discover({ campaign, sinceIso: since, limit: 12 })));
  }
  const known = new Set(existing.map((c) => c.post.id));
  const ranked = discovered
    .filter((p) => !known.has(p.id))
    .filter((p) => !wasSeen(session.userId, p.id))
    .filter((p) => new Date(p.createdAt).getTime() >= Date.now() - FRESHNESS_MS);
  const scored: { post: SocialPost; score: ReturnType<typeof scorePost> }[] = [];
  for (const post of ranked) {
    if (await isBlocked(session.userId, post.network, post.authorHandle)) continue;
    const score = scorePost(post, campaign, passed);
    if (score.value < SCORE_THRESHOLD) continue;
    scored.push({ post, score });
  }
  scored.sort((a, b) => b.score.value - a.score.value || b.post.createdAt.localeCompare(a.post.createdAt));
  const take = scored.slice(0, Math.max(0, 6 - open.length));
  for (const item of take) {
    await rememberSeen(session.userId, item.post.id);
    const frequent = logs.filter((l) => l.externalPostId.startsWith(item.post.authorHandle)).length >= 2;
    const card: InboxCard = {
      id: newId("crd"),
      sessionId: session.id,
      userId: session.userId,
      campaignId: campaign.id,
      post: item.post,
      score: item.score,
      draft: "",
      status: "new",
      offeredAt: nowIso(),
      actedAt: null,
      replyTargetId: item.post.replyTargets?.[0]?.id ?? null,
      frequent,
    };
    card.draft = await generateDraft({
      post: item.post,
      campaign,
      voice: acting?.voiceProfile ?? { bio: writing.bio, writingNotes: writing.writingNotes, replyLength: writing.replyLength, samplePosts: [] },
      writing,
      job: "draft",
    });
    await saveCard(card);
  }
  const after = (await listCards(session.id)).filter((c) => c.status === "new");
  session.queueCount = after.length;
}

export async function previewPosts(campaign: Campaign, networks: Network[]): Promise<SocialPost[]> {
  const since = new Date(Date.now() - FRESHNESS_MS).toISOString();
  const out: SocialPost[] = [];
  for (const network of networks) {
    out.push(...(await adapterFor(network).discover({ campaign, sinceIso: since, limit: 4 })));
  }
  return out.slice(0, 4);
}
