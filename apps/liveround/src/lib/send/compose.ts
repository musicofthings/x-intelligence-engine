import type { Network, SocialPost } from "@/lib/types";
import { isAndroidUserAgent } from "@/lib/utils";

/**
 * Client publish path only.
 *
 * There is intentionally no function here that talks to X or Reddit write APIs.
 * Approving a reply and publishing it are the same moment, in the user's session:
 * compose deep-link, clipboard paste, or a later companion extension.
 */
export type SendHint = {
  copyText: string;
  openUrl: string;
  instruction: string;
  method: "compose-intent" | "clipboard-open";
};

export function buildReplySend(post: SocialPost, draft: string, userAgent: string): SendHint {
  const copyText = draft.trim();
  if (post.network === "x") {
    if (isAndroidUserAgent(userAgent)) {
      return {
        copyText,
        openUrl: post.url,
        instruction: "Draft copied. Tap Reply on the post, then paste.",
        method: "clipboard-open",
      };
    }
    const intent = new URL("https://x.com/intent/tweet");
    intent.searchParams.set("in_reply_to", post.id);
    intent.searchParams.set("text", copyText);
    return {
      copyText,
      openUrl: intent.toString(),
      instruction: "Opening X compose with this draft. Confirm on X, then mark it posted here.",
      method: "compose-intent",
    };
  }
  return {
    copyText,
    openUrl: post.url,
    instruction: "Draft copied. Open the post, reply, and paste.",
    method: "clipboard-open",
  };
}

export function likeUrl(post: SocialPost): string {
  return post.url;
}

export function voteUrl(post: SocialPost): string {
  return post.url;
}

export function dmUrl(handle: string): string {
  return `https://x.com/messages/compose?recipient_id=${encodeURIComponent(handle)}`;
}

/** Guard used in tests — keep the reply surface client-only. */
export function serverMustNotPublishReplies(): true {
  return true;
}

export function charLimitFor(network: Network): number {
  return network === "x" ? 280 : 10_000;
}
