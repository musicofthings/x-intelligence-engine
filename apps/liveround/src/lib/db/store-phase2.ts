import { eq } from "drizzle-orm";
import { getDb } from "./client";
import * as t from "./schema";
import type { Contact, PostIdea, PostingSettings } from "@/lib/types";
import { newId } from "@/lib/utils";

interface Phase2Mem {
  ideas: Map<string, PostIdea>;
  posting: Map<string, PostingSettings>;
  contacts: Map<string, Contact>;
  oauth: Map<string, { userId: string; verifier: string; provider: string; expires: number }>;
}

const g = globalThis as typeof globalThis & { __liveroundP2?: Phase2Mem };

function p2(): Phase2Mem {
  if (!g.__liveroundP2) {
    g.__liveroundP2 = {
      ideas: new Map(),
      posting: new Map(),
      contacts: new Map(),
      oauth: new Map(),
    };
  }
  return g.__liveroundP2;
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
}

function rowToIdea(row: typeof t.postIdeas.$inferSelect): PostIdea {
  return {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    text: row.text,
    status: row.status as PostIdea["status"],
    failReason: row.failReason,
    scheduledAt: iso(row.scheduledAt),
    postedAt: iso(row.postedAt),
    externalPostId: row.externalPostId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function saveOAuthState(input: {
  state: string;
  userId: string;
  provider: string;
  codeVerifier: string;
  expiresAt: number;
}): Promise<void> {
  const db = getDb();
  if (db) {
    await db.insert(t.oauthStates).values({
      state: input.state,
      userId: input.userId,
      provider: input.provider,
      codeVerifier: input.codeVerifier,
      expiresAt: new Date(input.expiresAt),
    });
    return;
  }
  p2().oauth.set(input.state, {
    userId: input.userId,
    verifier: input.codeVerifier,
    provider: input.provider,
    expires: input.expiresAt,
  });
}

export async function consumeOAuthState(
  state: string,
): Promise<{ userId: string; verifier: string; provider: string } | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.oauthStates).where(eq(t.oauthStates.state, state)).limit(1);
    const row = rows[0];
    if (!row) return null;
    await db.delete(t.oauthStates).where(eq(t.oauthStates.state, state));
    if (row.expiresAt.getTime() < Date.now()) return null;
    return { userId: row.userId, verifier: row.codeVerifier, provider: row.provider };
  }
  const row = p2().oauth.get(state);
  p2().oauth.delete(state);
  if (!row || row.expires < Date.now()) return null;
  return { userId: row.userId, verifier: row.verifier, provider: row.provider };
}

export async function saveIdea(idea: PostIdea): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.postIdeas)
      .values({
        ...idea,
        scheduledAt: idea.scheduledAt ? new Date(idea.scheduledAt) : null,
        postedAt: idea.postedAt ? new Date(idea.postedAt) : null,
        createdAt: new Date(idea.createdAt),
        expiresAt: new Date(idea.expiresAt),
      })
      .onConflictDoUpdate({
        target: t.postIdeas.id,
        set: {
          text: idea.text,
          status: idea.status,
          failReason: idea.failReason,
          scheduledAt: idea.scheduledAt ? new Date(idea.scheduledAt) : null,
          postedAt: idea.postedAt ? new Date(idea.postedAt) : null,
          externalPostId: idea.externalPostId,
        },
      });
    return;
  }
  p2().ideas.set(idea.id, idea);
}

export async function getIdea(id: string): Promise<PostIdea | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.postIdeas).where(eq(t.postIdeas.id, id)).limit(1);
    return rows[0] ? rowToIdea(rows[0]) : null;
  }
  return p2().ideas.get(id) ?? null;
}

export async function listIdeas(userId: string): Promise<PostIdea[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.postIdeas).where(eq(t.postIdeas.userId, userId));
    return rows.map(rowToIdea).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return [...p2().ideas.values()]
    .filter((i) => i.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listDueIdeas(now = Date.now()): Promise<PostIdea[]> {
  const cutoff = new Date(now);
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.postIdeas);
    return rows
      .map(rowToIdea)
      .filter((i) => (i.status === "approved" || i.status === "queued") && i.scheduledAt && new Date(i.scheduledAt) <= cutoff);
  }
  return [...p2().ideas.values()].filter(
    (i) => (i.status === "approved" || i.status === "queued") && i.scheduledAt && new Date(i.scheduledAt).getTime() <= now,
  );
}

export async function expireStaleIdeas(now = Date.now()): Promise<number> {
  const ideas = getDb()
    ? (await getDb()!.select().from(t.postIdeas)).map(rowToIdea)
    : [...p2().ideas.values()];
  let n = 0;
  for (const idea of ideas) {
    if (idea.status === "draft" && new Date(idea.expiresAt).getTime() <= now) {
      idea.status = "expired";
      await saveIdea(idea);
      n += 1;
    }
  }
  return n;
}

export function defaultPosting(userId: string): PostingSettings {
  return {
    userId,
    postsPerDay: 3,
    windowStart: "09:00",
    windowEnd: "17:00",
    timezone: "America/New_York",
  };
}

export async function savePosting(settings: PostingSettings): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.postingSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: t.postingSettings.userId,
        set: {
          postsPerDay: settings.postsPerDay,
          windowStart: settings.windowStart,
          windowEnd: settings.windowEnd,
          timezone: settings.timezone,
        },
      });
    return;
  }
  p2().posting.set(settings.userId, settings);
}

export async function getPosting(userId: string): Promise<PostingSettings> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.postingSettings).where(eq(t.postingSettings.userId, userId)).limit(1);
    if (rows[0]) return rows[0];
  }
  return p2().posting.get(userId) ?? defaultPosting(userId);
}

export async function saveContact(contact: Contact): Promise<void> {
  const db = getDb();
  if (db) {
    await db
      .insert(t.contacts)
      .values({ ...contact, lastAt: new Date(contact.lastAt) })
      .onConflictDoUpdate({
        target: [t.contacts.userId, t.contacts.network, t.contacts.handle],
        set: {
          score: contact.score,
          ourReplies: contact.ourReplies,
          theirReplies: contact.theirReplies,
          lastAt: new Date(contact.lastAt),
        },
      });
    return;
  }
  const key = `${contact.userId}:${contact.network}:${contact.handle.toLowerCase()}`;
  const existing = [...p2().contacts.values()].find(
    (c) => c.userId === contact.userId && c.network === contact.network && c.handle.toLowerCase() === contact.handle.toLowerCase(),
  );
  if (existing) {
    p2().contacts.delete(existing.id);
    p2().contacts.set(existing.id, { ...contact, id: existing.id });
    return;
  }
  p2().contacts.set(contact.id || key, { ...contact, id: contact.id || newId("con") });
}

export async function listContacts(userId: string): Promise<Contact[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(t.contacts).where(eq(t.contacts.userId, userId));
    return rows.map((row) => ({
      ...row,
      network: row.network as Contact["network"],
      lastAt: row.lastAt.toISOString(),
    }));
  }
  return [...p2().contacts.values()]
    .filter((c) => c.userId === userId)
    .sort((a, b) => b.score - a.score);
}
