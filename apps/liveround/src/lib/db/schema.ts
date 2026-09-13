import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  plan: text("plan").notNull().default("trial"),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }).notNull(),
  planCredits: integer("plan_credits").notNull().default(0),
  permanentCredits: integer("permanent_credits").notNull().default(0),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
});

export const socialAccounts = pgTable("social_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("ok"),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  voiceProfile: jsonb("voice_profile").notNull(),
  activeSessionId: text("active_session_id"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  oauthEncrypted: text("oauth_encrypted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  actingAccountId: text("acting_account_id").notNull(),
  building: text("building").notNull(),
  reaching: text("reaching").notNull(),
  strategyX: text("strategy_x").notNull().default(""),
  strategyReddit: text("strategy_reddit").notNull().default(""),
  filterDoc: text("filter_doc").notNull().default(""),
  searchRules: jsonb("search_rules").notNull().default([]),
  subreddits: jsonb("subreddits").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const writingSettings = pgTable("writing_settings", {
  userId: text("user_id").primaryKey().references(() => users.id),
  bio: text("bio").notNull().default(""),
  writingNotes: text("writing_notes").notNull().default(""),
  replyLength: integer("reply_length").notNull().default(50),
});

export const roundSessions = pgTable("round_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  campaignId: text("campaign_id").notNull(),
  actingAccountId: text("acting_account_id").notNull(),
  networks: jsonb("networks").$type<string[]>().notNull(),
  state: text("state").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  liveMs: integer("live_ms").notNull().default(0),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull(),
  repliesCount: integer("replies_count").notNull().default(0),
  queueCount: integer("queue_count").notNull().default(0),
  lastTickMinute: integer("last_tick_minute").notNull().default(-1),
});

export const inboxCards = pgTable("inbox_cards", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  post: jsonb("post").notNull(),
  score: jsonb("score").notNull(),
  draft: text("draft").notNull().default(""),
  status: text("status").notNull().default("new"),
  offeredAt: timestamp("offered_at", { withTimezone: true }).notNull(),
  actedAt: timestamp("acted_at", { withTimezone: true }),
  replyTargetId: text("reply_target_id"),
  frequent: boolean("frequent").notNull().default(false),
});

export const replyLog = pgTable("reply_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  cardId: text("card_id").notNull(),
  network: text("network").notNull(),
  externalPostId: text("external_post_id").notNull(),
  body: text("body").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
});

export const blocks = pgTable("blocks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  network: text("network").notNull(),
  handle: text("handle").notNull(),
  until: timestamp("until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    intervalId: text("interval_id"),
    pool: text("pool").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("credit_ledger_session_interval").on(t.sessionId, t.intervalId)],
);

export const magicTokens = pgTable("magic_tokens", {
  token: text("token").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
