/** Frontend view types mirroring the API envelopes. */

export interface FeedPost {
  post: {
    id: string;
    xPostId: string;
    authorUsername: string | null;
    authorName: string | null;
    text: string;
    createdAt: string;
    url: string | null;
    metrics: { likeCount: number; repostCount: number; replyCount: number; quoteCount: number };
  };
  screening: {
    relevanceScore: number;
    noveltyScore: number;
    credibilityScore: number;
    strategicImportanceScore: number;
    topic: string;
    summary: string;
    recommendedAction: string;
    requiresFollowup: boolean;
  } | null;
  state: { isRead: boolean; isStarred: boolean; isArchived: boolean } | null;
}

export interface Monitor {
  id: string;
  name: string;
  slug: string;
  type: string;
  enabled: boolean;
  priority: number;
  xQuery: string | null;
  pollIntervalMinutes: number;
  maxResultsPerRun: number;
  prefilterThreshold: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface Alert {
  id: string;
  postId: string;
  severity: "info" | "medium" | "high" | "critical";
  title: string;
  reason: string;
  status: "open" | "acknowledged" | "dismissed" | "resolved";
  createdAt: string;
}

export interface Digest {
  id: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  executiveSummary: string | null;
  contentMarkdown: string | null;
}

export interface Watchlist {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  accountCount?: number;
}

export interface WatchlistAccount {
  id: string;
  watchlistId: string;
  username: string;
  displayName: string | null;
  priority: number;
  tags: string[];
  notes: string | null;
}

// ── Engagement layer ─────────────────────────────────────────────────────────

export type Network = "x" | "reddit";

export interface VoiceProfile {
  id: string;
  name: string;
  tone: string;
  audience: string | null;
  perspective: string | null;
  do: string[];
  dont: string[];
  sampleReplies: string[];
  maxChars: number;
}

export interface Campaign {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  networks: Network[];
  goalRepliesPerDay: number;
  voiceProfileId: string | null;
  strategy: string | null;
  monitorCount?: number;
}

export interface EngageItem {
  post: {
    id: string;
    network: Network;
    xPostId: string;
    authorUsername: string | null;
    authorName: string | null;
    text: string;
    url: string | null;
    createdAt: string;
    metrics: { likeCount: number; replyCount: number };
  };
  topic: string | null;
  strategicScore: number | null;
  relevanceScore: number | null;
  summary: string | null;
  queueScore: number;
  reasons: string[];
  draftCount: number;
  monitorNames: string[];
}

export interface ReplyDraft {
  id: string;
  postId: string;
  campaignId: string | null;
  body: string;
  status: "draft" | "sent" | "discarded";
  source: "ai" | "manual" | "transform";
  createdAt: string;
}

export interface SafetyWarning {
  code: string;
  severity: "warn" | "block";
  message: string;
  evidence: string | null;
}

export interface SafetyReport {
  warnings: SafetyWarning[];
  sendable: boolean;
  rulesVersion: string;
}

export interface EngagementSession {
  id: string;
  campaignId: string | null;
  goal: number;
  startedAt: string;
  endedAt: string | null;
  reviewed: number;
  repliesSent: number;
  skipped: number;
  follows: number;
  durationSeconds: number;
}

export interface EngageStats {
  daily_goal: number;
  replies_today: number;
  goal_met: boolean;
  by_day: { day: string; replies: number }[];
  recent_sessions: EngagementSession[];
  learning: {
    observations: number;
    engaged: number;
    skipped: number;
    top_authors: { key: string; net: number }[];
    top_topics: { key: string; net: number }[];
  };
}

export interface XOAuthStatus {
  configured: boolean;
  connected: boolean;
  username: string | null;
  scope: string | null;
  expires_at: string | null;
  missing: string[];
}
