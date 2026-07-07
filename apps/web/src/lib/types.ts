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
