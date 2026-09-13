import { CONTACT_WINDOW_MS, type Contact, type Network, type ReplyLogEntry } from "@/lib/types";
import { saveContact } from "@/lib/db/store-phase2";
import { newId, clamp } from "@/lib/utils";

/**
 * A contact is reciprocal. One outbound reply to a stranger is not a contact.
 */
export function reciprocalScore(ourReplies: number, theirReplies: number): number | null {
  if (ourReplies < 1 || theirReplies < 1) return null;
  return clamp(10 * ourReplies + 25 * theirReplies, 1, 100);
}

export function contactsFromLogs(
  userId: string,
  logs: ReplyLogEntry[],
  inbound: { network: Network; handle: string; at: string }[],
  now = Date.now(),
): Contact[] {
  const since = now - CONTACT_WINDOW_MS;
  const ours = new Map<string, { count: number; last: string; network: Network }>();
  for (const log of logs) {
    const at = Date.parse(log.confirmedAt);
    if (!Number.isFinite(at) || at < since) continue;
    const handle = inferHandle(log);
    if (!handle) continue;
    const key = `${log.network}:${handle.toLowerCase()}`;
    const prev = ours.get(key);
    ours.set(key, {
      network: log.network,
      count: (prev?.count ?? 0) + 1,
      last: !prev || log.confirmedAt > prev.last ? log.confirmedAt : prev.last,
    });
  }
  const theirs = new Map<string, { count: number; last: string }>();
  for (const row of inbound) {
    const at = Date.parse(row.at);
    if (!Number.isFinite(at) || at < since) continue;
    const key = `${row.network}:${row.handle.toLowerCase()}`;
    const prev = theirs.get(key);
    theirs.set(key, {
      count: (prev?.count ?? 0) + 1,
      last: !prev || row.at > prev.last ? row.at : prev.last,
    });
  }
  const out: Contact[] = [];
  for (const [key, oursRow] of ours) {
    const theirsRow = theirs.get(key);
    const score = reciprocalScore(oursRow.count, theirsRow?.count ?? 0);
    if (score === null) continue;
    const handle = key.slice(key.indexOf(":") + 1);
    out.push({
      id: newId("con"),
      userId,
      network: oursRow.network,
      handle,
      score,
      ourReplies: oursRow.count,
      theirReplies: theirsRow?.count ?? 0,
      lastAt: (theirsRow?.last ?? oursRow.last) > oursRow.last ? (theirsRow?.last ?? oursRow.last) : oursRow.last,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

function inferHandle(log: ReplyLogEntry): string | null {
  const fromId = log.externalPostId.split(":")[0];
  if (fromId && /[a-zA-Z]/.test(fromId) && fromId.length < 40) return fromId.replace(/^@/, "");
  return null;
}

export async function persistContacts(contacts: Contact[]): Promise<void> {
  for (const c of contacts) await saveContact(c);
}
