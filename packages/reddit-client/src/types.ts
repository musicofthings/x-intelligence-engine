/** Shapes returned by the official Reddit API. Everything here is untrusted input. */

export interface RedditPostData {
  id?: string;
  name?: string; // fullname, e.g. "t3_abc123"
  author?: string;
  author_fullname?: string;
  title?: string;
  selftext?: string;
  subreddit?: string;
  created_utc?: number;
  permalink?: string;
  url?: string;
  score?: number;
  ups?: number;
  num_comments?: number;
  over_18?: boolean;
  stickied?: boolean;
  is_self?: boolean;
  removed_by_category?: string | null;
}

export interface RedditChild {
  kind?: string;
  data?: RedditPostData;
}

export interface RedditListing {
  kind?: string;
  data?: {
    after?: string | null;
    before?: string | null;
    children?: RedditChild[];
  };
}

export interface RedditTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}
