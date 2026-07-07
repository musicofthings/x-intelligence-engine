-- 0002_fts.sql — full-text search (spec §31). FTS5 is available in Cloudflare D1.
-- The repository layer detects FTS availability at runtime and falls back to LIKE if
-- this virtual table is absent, so search works even where FTS5 is not applied.

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  post_id UNINDEXED,
  text,
  author_username,
  summary,
  reason,
  topic,
  subtopic,
  tokenize = 'porter unicode61'
);

-- Keep FTS in sync via triggers on the denormalized search source table.
-- We index screening-derived fields when a screening row is written; post text is
-- indexed at upsert. To keep triggers simple and idempotent, the pipeline writes to
-- posts_fts explicitly (see packages/db/src/search.ts). No AFTER triggers on posts to
-- avoid duplicate rows on metric-only updates.
