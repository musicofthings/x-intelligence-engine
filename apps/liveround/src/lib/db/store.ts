import { eq } from "drizzle-orm";
import { getDb } from "./client";
import * as t from "./schema";
import type {
  BlockEntry,
  Campaign,
  CreditLedgerEntry,
  InboxCard,
  ReplyLogEntry,
  RoundSession,
  SocialAccount,
  UserRecord,
  VoiceProfile,
  WritingSettings,
} from "@/lib/types";
import { TRIAL_GRANT } from "@/lib/types";
import { newId, nowIso } from "@/lib/utils";

interface Memory {
  users: Map<string, UserRecord>;
  usersByEmail: Map<string, string>;
  accounts: Map<string, SocialAccount>;
  campaigns: Map<string, Campaign>;
  writing: Map<string, WritingSettings>;
  sessions: Map<string, RoundSession>;
  cards: Map<string, InboxCard>;
  logs: Map<string, ReplyLogEntry>;
  blocks: Map<string, BlockEntry>;
  ledger: Map<string, CreditLedgerEntry>;
  intervals: Set<string>;
  magic: Map<string, { email: string; expiresAt: number }>;
  seenPosts: Set<string>;
}

const g = globalThis as typeof globalThis & { __liveroundMem?: Memory };

function mem(): Memory {
  if (!g.__liveroundMem) {
    g.__liveroundMem = {
      users: new Map(),
      usersByEmail: new Map(),
      accounts: new Map(),
      campaigns: new Map(),
      writing: new Map(),
      sessions: new Map(),
      cards: new Map(),
      logs: new Map(),
      blocks: new Map(),
      ledger: new Map(),
      intervals: new Set(),
      magic: new Map(),
      seenPosts: new Set(),
    };
  }
  return g.__liveroundMem;
}

const defaultVoice: VoiceProfile = {
  bio: "",
  writingNotes: "",
  replyLength: 50,
  samplePosts: [],
};

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
}

export async function ensureUser(email: string, name?: string | null): Promise<UserRecord> {
  const normalized = email.trim().toLowerCase();
  const existing = await getUserByEmail(normalized);
  if (existing) return existing;
  const user: UserRecord = {
    id: newId("usr"),
    email: normalized,
    name: name ?? null,
    image: null,
    createdAt: nowIso(),
    plan: "trial",
    trialStartedAt: nowIso(),
    planCredits: TRIAL_GRANT,
    permanentCredits: 0,
    onboardingComplete: false,
  };
  await saveUser(user);
  const account: SocialAccount = {
    id: newId("soc"),
    userId: user.id,
    provider: "mock_x",
    handle: "you",
    displayName: "Acting as you (mock X)",
    status: "ok",
    scopes: [],
    voiceProfile: { ...defaultVoice },
    activeSessionId: null,
    tokenExpiresAt: null,
    createdAt: nowIso(),
  };
  await saveAccount(account);
  await saveWriting({ userId: user.id, bio: "", writingNotes: "", replyLength: 50 });
  await appendLedger({
    id: newId("led"),
    userId: user.id,
    sessionId: null,
    intervalId: `trial:${user.id}`,
    pool: "plan",
    delta: TRIAL_GRANT,
    reason: "trial_grant",
    createdAt: nowIso(),
  });
  return user;
}

export async function saveUser(user: UserRecord): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.users)
      .values({
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        createdAt: new Date(user.createdAt),
        plan: user.plan,
        trialStartedAt: new Date(user.trialStartedAt),
        planCredits: user.planCredits,
        permanentCredits: user.permanentCredits,
        onboardingComplete: user.onboardingComplete,
      })
      .onConflictDoUpdate({
        target: t.users.id,
        set: {
          name: user.name,
          plan: user.plan,
          planCredits: user.planCredits,
          permanentCredits: user.permanentCredits,
          onboardingComplete: user.onboardingComplete,
        },
      });
    return;
  }
  const m = mem();
  m.users.set(user.id, user);
  m.usersByEmail.set(user.email, user.id);
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.users).where(eq(t.users.id, id)).limit(1);
    const row = rows[0];
    return row ? rowToUser(row) : null;
  }
  return mem().users.get(id) ?? null;
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1);
    const row = rows[0];
    return row ? rowToUser(row) : null;
  }
  const id = mem().usersByEmail.get(email);
  return id ? (mem().users.get(id) ?? null) : null;
}

function rowToUser(row: typeof t.users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    createdAt: row.createdAt.toISOString(),
    plan: row.plan as UserRecord["plan"],
    trialStartedAt: row.trialStartedAt.toISOString(),
    planCredits: row.planCredits,
    permanentCredits: row.permanentCredits,
    onboardingComplete: row.onboardingComplete,
  };
}

export async function saveAccount(account: SocialAccount): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.socialAccounts)
      .values({
        id: account.id,
        userId: account.userId,
        provider: account.provider,
        handle: account.handle,
        displayName: account.displayName,
        status: account.status,
        scopes: account.scopes,
        voiceProfile: account.voiceProfile,
        activeSessionId: account.activeSessionId,
        tokenExpiresAt: account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null,
        createdAt: new Date(account.createdAt),
      })
      .onConflictDoUpdate({
        target: t.socialAccounts.id,
        set: {
          handle: account.handle,
          displayName: account.displayName,
          status: account.status,
          voiceProfile: account.voiceProfile,
          activeSessionId: account.activeSessionId,
          tokenExpiresAt: account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null,
        },
      });
    return;
  }
  mem().accounts.set(account.id, account);
}

export async function listAccounts(userId: string): Promise<SocialAccount[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.socialAccounts).where(eq(t.socialAccounts.userId, userId));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      provider: row.provider as SocialAccount["provider"],
      handle: row.handle,
      displayName: row.displayName,
      status: row.status as SocialAccount["status"],
      scopes: row.scopes,
      voiceProfile: row.voiceProfile as VoiceProfile,
      activeSessionId: row.activeSessionId,
      tokenExpiresAt: iso(row.tokenExpiresAt),
      createdAt: row.createdAt.toISOString(),
    }));
  }
  return [...mem().accounts.values()].filter((a) => a.userId === userId);
}

export async function getAccount(id: string): Promise<SocialAccount | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.socialAccounts).where(eq(t.socialAccounts.id, id)).limit(1);
    const all = await listAccounts(rows[0]?.userId ?? "");
    return all.find((a) => a.id === id) ?? null;
  }
  return mem().accounts.get(id) ?? null;
}

export async function saveWriting(settings: WritingSettings): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.writingSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: t.writingSettings.userId,
        set: {
          bio: settings.bio,
          writingNotes: settings.writingNotes,
          replyLength: settings.replyLength,
        },
      });
    return;
  }
  mem().writing.set(settings.userId, settings);
}

export async function getWriting(userId: string): Promise<WritingSettings> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.writingSettings).where(eq(t.writingSettings.userId, userId)).limit(1);
    const row = rows[0];
    if (row) return row;
  }
  return mem().writing.get(userId) ?? { userId, bio: "", writingNotes: "", replyLength: 50 };
}

export async function saveCampaign(campaign: Campaign): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.campaigns)
      .values({
        ...campaign,
        createdAt: new Date(campaign.createdAt),
        updatedAt: new Date(campaign.updatedAt),
      })
      .onConflictDoUpdate({
        target: t.campaigns.id,
        set: {
          name: campaign.name,
          actingAccountId: campaign.actingAccountId,
          building: campaign.building,
          reaching: campaign.reaching,
          strategyX: campaign.strategyX,
          strategyReddit: campaign.strategyReddit,
          filterDoc: campaign.filterDoc,
          searchRules: campaign.searchRules,
          subreddits: campaign.subreddits,
          updatedAt: new Date(campaign.updatedAt),
        },
      });
    return;
  }
  mem().campaigns.set(campaign.id, campaign);
}

export async function listCampaigns(userId: string): Promise<Campaign[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.campaigns).where(eq(t.campaigns.userId, userId));
    return rows.map((row) => ({
      ...row,
      searchRules: row.searchRules as Campaign["searchRules"],
      subreddits: row.subreddits as Campaign["subreddits"],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
  return [...mem().campaigns.values()].filter((c) => c.userId === userId);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.campaigns).where(eq(t.campaigns.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      searchRules: row.searchRules as Campaign["searchRules"],
      subreddits: row.subreddits as Campaign["subreddits"],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  return mem().campaigns.get(id) ?? null;
}

export async function saveSession(session: RoundSession): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.roundSessions)
      .values({
        ...session,
        startedAt: new Date(session.startedAt),
        pausedAt: session.pausedAt ? new Date(session.pausedAt) : null,
        stoppedAt: session.stoppedAt ? new Date(session.stoppedAt) : null,
        lastActivityAt: new Date(session.lastActivityAt),
        lastHeartbeatAt: new Date(session.lastHeartbeatAt),
      })
      .onConflictDoUpdate({
        target: t.roundSessions.id,
        set: {
          state: session.state,
          pausedAt: session.pausedAt ? new Date(session.pausedAt) : null,
          stoppedAt: session.stoppedAt ? new Date(session.stoppedAt) : null,
          liveMs: session.liveMs,
          lastActivityAt: new Date(session.lastActivityAt),
          lastHeartbeatAt: new Date(session.lastHeartbeatAt),
          repliesCount: session.repliesCount,
          queueCount: session.queueCount,
          lastTickMinute: session.lastTickMinute,
        },
      });
    return;
  }
  mem().sessions.set(session.id, session);
}

export async function getSession(id: string): Promise<RoundSession | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.roundSessions).where(eq(t.roundSessions.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      networks: row.networks as RoundSession["networks"],
      state: row.state as RoundSession["state"],
      startedAt: row.startedAt.toISOString(),
      pausedAt: iso(row.pausedAt),
      stoppedAt: iso(row.stoppedAt),
      lastActivityAt: row.lastActivityAt.toISOString(),
      lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
    };
  }
  return mem().sessions.get(id) ?? null;
}

export async function activeSessionForUser(userId: string): Promise<RoundSession | null> {
  const all = await listSessions(userId);
  return all.find((s) => s.state !== "stopped") ?? null;
}

export async function liveSessionForAccount(accountId: string): Promise<RoundSession | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.roundSessions).where(eq(t.roundSessions.actingAccountId, accountId));
    return (
      rows
        .map((row) => ({
          ...row,
          networks: row.networks as RoundSession["networks"],
          state: row.state as RoundSession["state"],
          startedAt: row.startedAt.toISOString(),
          pausedAt: iso(row.pausedAt),
          stoppedAt: iso(row.stoppedAt),
          lastActivityAt: row.lastActivityAt.toISOString(),
          lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
        }))
        .find((s) => s.state === "live") ?? null
    );
  }
  return [...mem().sessions.values()].find((s) => s.actingAccountId === accountId && s.state === "live") ?? null;
}

async function listSessions(userId: string): Promise<RoundSession[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.roundSessions).where(eq(t.roundSessions.userId, userId));
    return rows.map((row) => ({
      ...row,
      networks: row.networks as RoundSession["networks"],
      state: row.state as RoundSession["state"],
      startedAt: row.startedAt.toISOString(),
      pausedAt: iso(row.pausedAt),
      stoppedAt: iso(row.stoppedAt),
      lastActivityAt: row.lastActivityAt.toISOString(),
      lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
    }));
  }
  return [...mem().sessions.values()].filter((s) => s.userId === userId);
}

export async function saveCard(card: InboxCard): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.inboxCards)
      .values({
        ...card,
        offeredAt: new Date(card.offeredAt),
        actedAt: card.actedAt ? new Date(card.actedAt) : null,
      })
      .onConflictDoUpdate({
        target: t.inboxCards.id,
        set: {
          draft: card.draft,
          status: card.status,
          actedAt: card.actedAt ? new Date(card.actedAt) : null,
          replyTargetId: card.replyTargetId,
          score: card.score,
        },
      });
    return;
  }
  mem().cards.set(card.id, card);
}

export async function getCard(id: string): Promise<InboxCard | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.inboxCards).where(eq(t.inboxCards.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...(row as unknown as InboxCard),
      offeredAt: row.offeredAt.toISOString(),
      actedAt: iso(row.actedAt),
    };
  }
  return mem().cards.get(id) ?? null;
}

export async function listCards(sessionId: string): Promise<InboxCard[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.inboxCards).where(eq(t.inboxCards.sessionId, sessionId));
    return rows.map((row) => ({
      ...(row as unknown as InboxCard),
      offeredAt: row.offeredAt.toISOString(),
      actedAt: iso(row.actedAt),
    }));
  }
  return [...mem().cards.values()].filter((c) => c.sessionId === sessionId);
}

export async function listUserCards(userId: string): Promise<InboxCard[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.inboxCards).where(eq(t.inboxCards.userId, userId));
    return rows.map((row) => ({
      ...(row as unknown as InboxCard),
      offeredAt: row.offeredAt.toISOString(),
      actedAt: iso(row.actedAt),
    }));
  }
  return [...mem().cards.values()].filter((c) => c.userId === userId);
}

export async function rememberSeen(userId: string, postId: string): Promise<void> {
  mem().seenPosts.add(`${userId}:${postId}`);
}

export function wasSeen(userId: string, postId: string): boolean {
  return mem().seenPosts.has(`${userId}:${postId}`);
}

export async function saveLog(entry: ReplyLogEntry): Promise<void> {
  const db = getDb();
  if (db) {
    await db.insert(t.replyLog).values({ ...entry, confirmedAt: new Date(entry.confirmedAt) });
    return;
  }
  mem().logs.set(entry.id, entry);
}

export async function listLogs(userId: string): Promise<ReplyLogEntry[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.replyLog).where(eq(t.replyLog.userId, userId));
    return rows.map((row) => ({
      ...row,
      network: row.network as ReplyLogEntry["network"],
      confirmedAt: row.confirmedAt.toISOString(),
    }));
  }
  return [...mem().logs.values()]
    .filter((l) => l.userId === userId)
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}

export async function saveBlock(block: BlockEntry): Promise<void> {
  const db = getDb();
  if (db) {
    await db.insert(t.blocks).values({
      ...block,
      until: block.until ? new Date(block.until) : null,
      createdAt: new Date(block.createdAt),
    });
    return;
  }
  mem().blocks.set(block.id, block);
}

export async function isBlocked(userId: string, network: string, handle: string, now = Date.now()): Promise<boolean> {
  const db = getDb();
  const rows = db
    ? await db.select().from(t.blocks).where(eq(t.blocks.userId, userId))
    : [...mem().blocks.values()].filter((b) => b.userId === userId);
  return rows.some((b) => {
    const h = "handle" in b ? b.handle : "";
    const n = "network" in b ? b.network : "";
    if (h.toLowerCase() !== handle.toLowerCase() || n !== network) return false;
    const until = "until" in b ? b.until : null;
    if (!until) return true;
    const ts = until instanceof Date ? until.getTime() : new Date(until).getTime();
    return ts > now;
  });
}

export async function appendLedger(entry: CreditLedgerEntry): Promise<boolean> {
  if (entry.sessionId && entry.intervalId) {
    const key = `${entry.sessionId}:${entry.intervalId}`;
    if (mem().intervals.has(key)) return false;
    mem().intervals.add(key);
  }
  const db = getDb();
  if (db) {
    try {
      await db.insert(t.creditLedger).values({ ...entry, createdAt: new Date(entry.createdAt) });
    } catch {
      return false;
    }
    return true;
  }
  mem().ledger.set(entry.id, entry);
  return true;
}

export async function putMagic(token: string, email: string, expiresAt: number): Promise<void> {
  const db = getDb();
  if (db) {
    await db.insert(t.magicTokens).values({ token, email, expiresAt: new Date(expiresAt) });
    return;
  }
  mem().magic.set(token, { email, expiresAt });
}

export async function consumeMagic(token: string): Promise<string | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.magicTokens).where(eq(t.magicTokens.token, token)).limit(1);
    const row = rows[0];
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    await db.delete(t.magicTokens).where(eq(t.magicTokens.token, token));
    return row.email;
  }
  const row = mem().magic.get(token);
  if (!row || row.expiresAt < Date.now()) return null;
  mem().magic.delete(token);
  return row.email;
}
