/** Canonical shared domain types (spec §61). Import these everywhere; never redefine. */

export type MonitorType =
  | "recent_search"
  | "user_watchlist"
  | "x_list"
  | "filtered_stream_rule";

export type SourceType =
  | "recent_search"
  | "user_timeline"
  | "x_list"
  | "webhook";

export interface Monitor {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: MonitorType;
  enabled: boolean;
  priority: number;
  xQuery: string | null;
  xListId: string | null;
  pollIntervalMinutes: number;
  maxResultsPerRun: number;
  maxPagesPerRun: number;
  prefilterThreshold: number;
  aiScreeningThreshold: number;
  alertThreshold: number;
  language: string | null;
  excludedTerms: string[];
  requiredTerms: string[];
  schedule: Record<string, unknown> | null;
  budget: { dailyResourceLimit?: number } | null;
  sinceId: string | null;
  paginationState: Record<string, unknown> | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Watchlist {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistAccount {
  id: string;
  watchlistId: string;
  xUserId: string | null;
  username: string;
  displayName: string | null;
  priority: number;
  tags: string[];
  notes: string | null;
  enabled: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostMetrics {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
  impressionCount: number;
}

export interface NormalizedXPost {
  xPostId: string;
  authorId: string;
  authorUsername: string | null;
  authorName: string | null;
  text: string;
  lang: string | null;
  createdAt: string;
  conversationId: string | null;
  inReplyToUserId: string | null;
  url: string | null;
  metrics: PostMetrics;
  /** Untrusted, unmodified upstream payload for audit/dev view. */
  raw: unknown;
}

export interface MonitorMatch {
  postId: string;
  monitorId: string;
  matchedRule: string | null;
  matchMetadata: Record<string, unknown> | null;
  matchedAt: string;
}

export interface PrefilterFactor {
  key: string;
  label: string;
  points: number;
}

export type PrefilterDecision = "pass" | "reject";

export interface PrefilterResult {
  score: number;
  keywordScore: number;
  sourceScore: number;
  engagementScore: number;
  primarySourceScore: number;
  penaltyScore: number;
  decision: PrefilterDecision;
  reasons: PrefilterFactor[];
  rulesVersion: string;
}

export interface ScreeningEntity {
  name: string;
  type:
    | "company"
    | "person"
    | "drug"
    | "target"
    | "trial"
    | "model"
    | "technology"
    | "regulator"
    | "conference"
    | "other";
}

export interface ScreeningResult {
  relevanceScore: number;
  noveltyScore: number;
  credibilityScore: number;
  strategicImportanceScore: number;
  topic: string;
  subtopic: string;
  requiresFollowup: boolean;
  reason: string;
  summary: string;
  recommendedAction: string;
  entities: ScreeningEntity[];
  risks: string[];
  evidence: string[];
}

export interface ScreeningRecord extends ScreeningResult {
  id: string;
  postId: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  scoredAt: string;
  createdAt: string;
}

export type AlertSeverity = "info" | "medium" | "high" | "critical";
export type AlertStatus = "open" | "acknowledged" | "dismissed" | "resolved";

export interface Alert {
  id: string;
  postId: string;
  monitorId: string | null;
  severity: AlertSeverity;
  title: string;
  reason: string;
  status: AlertStatus;
  deliveryStatus: string | null;
  deliveryAttempts: number;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export type DigestType = "daily" | "weekly" | "custom";

export interface Digest {
  id: string;
  type: DigestType;
  periodStart: string;
  periodEnd: string;
  title: string;
  executiveSummary: string | null;
  contentMarkdown: string | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IngestionRunStatus =
  | "running"
  | "success"
  | "failed"
  | "skipped_budget"
  | "skipped_not_due"
  | "skipped_disabled";

export interface IngestionRun {
  id: string;
  monitorId: string;
  runKey: string;
  status: IngestionRunStatus;
  startedAt: string;
  completedAt: string | null;
  postsRequested: number;
  postsReceived: number;
  postsNew: number;
  postsDuplicate: number;
  postsEnqueued: number;
  estimatedXCostUsd: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ApiUsage {
  id: string;
  provider: "x" | "anthropic";
  operation: string;
  monitorId: string | null;
  resourceCount: number;
  requestCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

export interface AppSettings {
  key: string;
  value: unknown;
  isSecretReference: boolean;
  updatedAt: string;
}

export interface PostState {
  postId: string;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isDismissed: boolean;
  notes: string | null;
  updatedAt: string;
}

export interface CursorPage<T> {
  data: T[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
  };
}
