export type Network = "x" | "reddit";
export type AdapterId = Network | "mock_x";

export type PlanId = "trial" | "scout" | "hunter" | "apex" | "paused";

export type SessionState = "precheck" | "live" | "idle_pause" | "credit_pause" | "stopped";

export type CardStatus = "new" | "replied" | "passed" | "blocked";

export type CreditPool = "plan" | "permanent";

export type CreditReason = "session_live_tick" | "trial_grant" | "pack" | "plan_reset" | "adjustment";

export type PostIdeaStatus = "draft" | "approved" | "queued" | "posted" | "failed" | "expired";

export type VolumeBand = "quiet" | "ok" | "noisy";

export interface VolumeReport {
  query: string;
  count24h: number;
  band: VolumeBand;
  message: string;
  retryable: boolean;
}

export interface PostIdea {
  id: string;
  userId: string;
  sessionId: string;
  text: string;
  status: PostIdeaStatus;
  failReason: string | null;
  scheduledAt: string | null;
  postedAt: string | null;
  externalPostId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface PostingSettings {
  userId: string;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
}

export interface Contact {
  id: string;
  userId: string;
  network: Network;
  handle: string;
  score: number;
  ourReplies: number;
  theirReplies: number;
  lastAt: string;
}

export interface XTokenSet {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: string | null;
  tokenType: string;
}

export interface SocialMetrics {
  likes: number;
  replies: number;
  reposts: number;
  saves: number;
  comments: number;
}

export interface SocialMedia {
  kind: "image" | "link";
  url: string;
  alt?: string;
}

export interface SocialPost {
  network: Network;
  adapter: AdapterId;
  id: string;
  url: string;
  authorId: string;
  authorHandle: string;
  authorName: string;
  body: string;
  createdAt: string;
  conversationId: string;
  metrics: SocialMetrics;
  media: SocialMedia[];
  authorFollowers?: number;
  /** Reddit thread targets the user can switch between. */
  replyTargets?: ReplyTarget[];
}

export interface ReplyTarget {
  id: string;
  kind: "post" | "comment";
  authorHandle: string;
  body: string;
  url: string;
}

export interface MatchScore {
  value: number;
  label: string;
  rationale: string;
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

export interface VoiceProfile {
  bio: string;
  writingNotes: string;
  replyLength: number;
  samplePosts: string[];
}

export interface SearchRule {
  query: string;
  source: "generated" | "manual";
}

export interface SubredditRef {
  name: string;
  title: string;
  description: string;
  members: number;
}

export interface Campaign {
  id: string;
  userId: string;
  name: string;
  actingAccountId: string;
  building: string;
  reaching: string;
  strategyX: string;
  strategyReddit: string;
  filterDoc: string;
  searchRules: SearchRule[];
  subreddits: SubredditRef[];
  /** 0 means no cutoff. Applied to X discovery only. */
  minFollowers: number;
  createdAt: string;
  updatedAt: string;
}

export interface SocialAccount {
  id: string;
  userId: string;
  provider: AdapterId;
  handle: string;
  displayName: string;
  status: "ok" | "expired" | "disconnected";
  scopes: string[];
  voiceProfile: VoiceProfile;
  activeSessionId: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
}

export interface WritingSettings {
  userId: string;
  bio: string;
  writingNotes: string;
  replyLength: number;
}

export interface RoundSession {
  id: string;
  userId: string;
  campaignId: string;
  actingAccountId: string;
  networks: Network[];
  state: SessionState;
  startedAt: string;
  pausedAt: string | null;
  stoppedAt: string | null;
  liveMs: number;
  lastActivityAt: string;
  lastHeartbeatAt: string;
  repliesCount: number;
  queueCount: number;
  lastTickMinute: number;
}

export interface InboxCard {
  id: string;
  sessionId: string;
  userId: string;
  campaignId: string;
  post: SocialPost;
  score: MatchScore;
  draft: string;
  status: CardStatus;
  offeredAt: string;
  actedAt: string | null;
  replyTargetId: string | null;
  frequent: boolean;
}

export interface ReplyLogEntry {
  id: string;
  userId: string;
  sessionId: string;
  cardId: string;
  network: Network;
  externalPostId: string;
  body: string;
  confirmedAt: string;
}

export interface BlockEntry {
  id: string;
  userId: string;
  network: Network;
  handle: string;
  until: string | null;
  createdAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  sessionId: string | null;
  intervalId: string | null;
  pool: CreditPool;
  delta: number;
  reason: CreditReason;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  createdAt: string;
  plan: PlanId;
  trialStartedAt: string;
  planCredits: number;
  permanentCredits: number;
  onboardingComplete: boolean;
  billingPaused: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planPeriodEnd: string | null;
  lastRecapOn: string | null;
}

export interface CreditBalance {
  plan: number;
  permanent: number;
  total: number;
}

export interface SessionSnapshot {
  session: RoundSession | null;
  campaign: Campaign | null;
  acting: SocialAccount | null;
  current: InboxCard | null;
  queue: InboxCard[];
  credits: CreditBalance;
  xConfigured: boolean;
  redditConfigured: boolean;
  anthropicConfigured: boolean;
  stripeConfigured: boolean;
  billingPaused: boolean;
  trialExpired: boolean;
  plan: PlanId;
}

export interface AdapterDiscoverInput {
  campaign: Campaign;
  sinceIso: string;
  limit: number;
  accessToken?: string;
}

export interface SocialAdapter {
  id: AdapterId;
  network: Network;
  label: string;
  configured: boolean;
  discover(input: AdapterDiscoverInput): Promise<SocialPost[]>;
  validateTarget?(raw: string): Promise<SubredditRef | SearchRule>;
}

export const START_CREDIT_FLOOR = 3;
export const IDLE_PAUSE_MS = 5 * 60_000;
export const HARD_CAP_MS = 60 * 60_000;
export const FRESHNESS_MS = 24 * 60 * 60_000;
export const CREDIT_MS_PER_UNIT = 60_000;
export const TRIAL_GRANT = 50;
export const TRIAL_DAYS = 7;
export const X_CHAR_LIMIT = 280;
export const REDDIT_CHAR_LIMIT = 10_000;
export const IDEA_EXPIRE_DAYS = 14;
export const IDEA_DISTILL_MIN_REPLIES = 12;
export const CONTACT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const VOLUME_QUIET_MAX = 4;
export const VOLUME_NOISY_MIN = 80;
