import type { CursorPage } from "@xie/shared";
import type { D1Like } from "./d1.js";
import { rowToPost, rowToScreening, rowToState, type PostRow } from "./rows.js";
import type { ScreeningRecord, PostState } from "@xie/shared";

/** Intelligence feed query (spec §6.2) with filters + cursor pagination (spec §20). */

export interface FeedFilters {
  monitorId?: string;
  topic?: string;
  authorUsername?: string;
  dateFrom?: string;
  dateTo?: string;
  minRelevance?: number;
  minStrategic?: number;
  requiresFollowup?: boolean;
  starred?: boolean;
  unread?: boolean;
  archived?: boolean;
  alerted?: boolean;
  language?: string;
  search?: string;
  limit?: number;
  cursor?: string | null;
}

export interface FeedItem {
  post: PostRow;
  screening: ScreeningRecord | null;
  state: PostState | null;
}

/** Cursor encodes (created_at, id) for stable keyset pagination. */
function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`);
}
function decodeCursor(c: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = atob(c).split("|");
    if (createdAt === undefined || id === undefined) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function queryFeed(db: D1Like, f: FeedFilters): Promise<CursorPage<FeedItem>> {
  const limit = Math.min(100, Math.max(1, f.limit ?? 25));
  const where: string[] = [];
  const binds: unknown[] = [];

  const needsScreening =
    f.topic !== undefined || f.minRelevance !== undefined || f.minStrategic !== undefined || f.requiresFollowup !== undefined;

  let sql = `SELECT p.* FROM posts p`;
  if (f.monitorId) {
    sql += ` JOIN post_monitor_matches pmm ON pmm.post_id = p.id AND pmm.monitor_id = ?`;
    binds.push(f.monitorId);
  }
  if (needsScreening) sql += ` JOIN screening_results s ON s.post_id = p.id`;
  sql += ` LEFT JOIN post_states st ON st.post_id = p.id`;
  if (f.alerted) sql += ` JOIN alerts a ON a.post_id = p.id`;

  if (f.topic) { where.push(`s.topic = ?`); binds.push(f.topic); }
  if (f.minRelevance !== undefined) { where.push(`s.relevance_score >= ?`); binds.push(f.minRelevance); }
  if (f.minStrategic !== undefined) { where.push(`s.strategic_importance_score >= ?`); binds.push(f.minStrategic); }
  if (f.requiresFollowup !== undefined) { where.push(`s.requires_followup = ?`); binds.push(f.requiresFollowup ? 1 : 0); }
  if (f.authorUsername) { where.push(`p.author_username = ?`); binds.push(f.authorUsername); }
  if (f.dateFrom) { where.push(`p.created_at >= ?`); binds.push(f.dateFrom); }
  if (f.dateTo) { where.push(`p.created_at < ?`); binds.push(f.dateTo); }
  if (f.language) { where.push(`p.lang = ?`); binds.push(f.language); }
  if (f.starred) where.push(`COALESCE(st.is_starred,0) = 1`);
  if (f.unread) where.push(`COALESCE(st.is_read,0) = 0`);
  if (f.archived !== undefined) where.push(`COALESCE(st.is_archived,0) = ${f.archived ? 1 : 0}`);
  if (f.search) { where.push(`(p.text LIKE ? OR p.author_username LIKE ?)`); const q = `%${f.search}%`; binds.push(q, q); }

  const cur = f.cursor ? decodeCursor(f.cursor) : null;
  if (cur) { where.push(`(p.created_at < ? OR (p.created_at = ? AND p.id < ?))`); binds.push(cur.createdAt, cur.createdAt, cur.id); }

  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY p.created_at DESC, p.id DESC LIMIT ?`;
  binds.push(limit + 1);

  const { results } = await db.prepare(sql).bind(...binds).all();
  const posts = results.map(rowToPost);
  const hasMore = posts.length > limit;
  const page = hasMore ? posts.slice(0, limit) : posts;

  const items: FeedItem[] = [];
  for (const post of page) {
    const s = await db.prepare("SELECT * FROM screening_results WHERE post_id=? ORDER BY scored_at DESC LIMIT 1").bind(post.id).first();
    const st = await db.prepare("SELECT * FROM post_states WHERE post_id=?").bind(post.id).first();
    items.push({ post, screening: s ? rowToScreening(s) : null, state: st ? rowToState(st) : null });
  }

  const last = page[page.length - 1];
  return {
    data: items,
    page: {
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    },
  };
}
