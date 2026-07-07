/** Raw X API v2 response shapes (subset of current official fields, spec §7.1). */

export interface XPublicMetrics {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
}

export interface XReferencedTweet {
  type: "retweeted" | "quoted" | "replied_to";
  id: string;
}

export interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  lang?: string;
  in_reply_to_user_id?: string;
  public_metrics?: XPublicMetrics;
  referenced_tweets?: XReferencedTweet[];
  entities?: unknown;
}

export interface XUser {
  id: string;
  name?: string;
  username?: string;
  description?: string;
  verified?: boolean;
  public_metrics?: Record<string, number>;
}

export interface XIncludes {
  users?: XUser[];
  tweets?: XTweet[];
}

export interface XSearchMeta {
  newest_id?: string;
  oldest_id?: string;
  result_count?: number;
  next_token?: string;
}

export interface XSearchResponse {
  data?: XTweet[];
  includes?: XIncludes;
  meta?: XSearchMeta;
  errors?: unknown[];
}

/** Default field set for intelligence analysis (spec §7.1) — intentionally lean. */
export const TWEET_FIELDS = [
  "id",
  "text",
  "author_id",
  "created_at",
  "conversation_id",
  "lang",
  "public_metrics",
  "referenced_tweets",
  "in_reply_to_user_id",
].join(",");

export const USER_FIELDS = ["id", "name", "username", "description", "verified", "public_metrics"].join(",");

export const EXPANSIONS = ["author_id", "referenced_tweets.id"].join(",");
