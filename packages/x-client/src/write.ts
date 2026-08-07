import { AppError } from "@xie/shared";
import { parseRateLimit, type RateLimitInfo } from "./ratelimit.js";

/**
 * X write operations under user-context OAuth 2.0 (spec §7.6). Deliberately minimal:
 * this app posts replies the analyst has explicitly pressed send on, and nothing else.
 * There is no bulk endpoint, no scheduling, and no auto-post path anywhere in the code.
 */

const API_BASE = "https://api.x.com";

/** X counts a post by characters, and 280 is the free/basic ceiling. */
export const X_MAX_REPLY_CHARS = 280;

export interface XWriteConfig {
  /** A *user-context* access token. An app-only bearer cannot post. */
  accessToken: string;
  baseUrl?: string;
}

export interface PostedReply {
  id: string;
  text: string;
  rateLimit: RateLimitInfo;
}

export interface XMe {
  id: string;
  username: string | null;
  name: string | null;
}

export class XWriteClient {
  private readonly token: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: XWriteConfig, fetchImpl: typeof fetch = fetch) {
    if (!cfg.accessToken) {
      throw new AppError("AUTHENTICATION_ERROR", "No X account connected — connect one to send replies");
    }
    this.token = cfg.accessToken;
    this.base = (cfg.baseUrl ?? API_BASE).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  /**
   * POST /2/tweets — publish `text` as a reply to `inReplyToPostId`.
   *
   * Callers must have already run the deterministic safety checks and recorded an
   * idempotency key; this method performs the network call and nothing else.
   */
  async replyTo(inReplyToPostId: string, text: string): Promise<PostedReply> {
    const body = text.trim();
    if (!body) throw new AppError("VALIDATION_ERROR", "Reply text is empty");
    if (body.length > X_MAX_REPLY_CHARS) {
      throw new AppError("VALIDATION_ERROR", `Reply exceeds ${X_MAX_REPLY_CHARS} characters`);
    }
    if (!/^\d+$/.test(inReplyToPostId)) {
      throw new AppError("VALIDATION_ERROR", "in_reply_to_tweet_id must be a numeric X post id");
    }

    const doFetch = this.fetchImpl;
    const res = await doFetch(`${this.base}/2/tweets`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ text: body, reply: { in_reply_to_tweet_id: inReplyToPostId } }),
    });
    const rateLimit = parseRateLimit(res.headers);
    if (!res.ok) {
      throw new AppError(statusToCode(res.status), "X reply request failed", {
        detail: { status: res.status, body: await safeText(res) },
      });
    }
    const json = (await res.json()) as { data?: { id?: string; text?: string } };
    if (!json.data?.id) {
      throw new AppError("X_API_ERROR", "X accepted the reply but returned no post id");
    }
    return { id: json.data.id, text: json.data.text ?? body, rateLimit };
  }

  /** GET /2/users/me — identifies the connected account after the OAuth callback. */
  async me(): Promise<XMe> {
    const doFetch = this.fetchImpl;
    const res = await doFetch(`${this.base}/2/users/me?user.fields=username,name`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new AppError(statusToCode(res.status), "X identity lookup failed", {
        detail: { status: res.status, body: await safeText(res) },
      });
    }
    const json = (await res.json()) as { data?: { id?: string; username?: string; name?: string } };
    if (!json.data?.id) throw new AppError("X_API_ERROR", "X returned no user id");
    return { id: json.data.id, username: json.data.username ?? null, name: json.data.name ?? null };
  }
}

function statusToCode(status: number) {
  return status === 401
    ? "AUTHENTICATION_ERROR"
    : status === 403
      ? "AUTHORIZATION_ERROR"
      : status === 429
        ? "RATE_LIMIT_ERROR"
        : "X_API_ERROR";
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
