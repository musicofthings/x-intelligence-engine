import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReplySend, dmUrl, serverMustNotPublishReplies } from "./compose";
import type { SocialPost } from "../types";

const post: SocialPost = {
  network: "x",
  adapter: "mock_x",
  id: "123",
  url: "https://x.com/a/status/123",
  authorId: "a",
  authorHandle: "a",
  authorName: "A",
  body: "hello",
  createdAt: new Date().toISOString(),
  conversationId: "123",
  metrics: { likes: 0, replies: 0, reposts: 0, saves: 0, comments: 0 },
  media: [],
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("human-press send path", () => {
  it("opens compose or clipboard — never a write API", () => {
    const desktop = buildReplySend(post, "draft", "Mozilla/5.0 Macintosh");
    expect(desktop.method).toBe("compose-intent");
    expect(desktop.openUrl).toContain("intent/tweet");
    expect(desktop.openUrl).toContain("in_reply_to=123");
    const android = buildReplySend(post, "draft", "Mozilla/5.0 Android");
    expect(android.method).toBe("clipboard-open");
    expect(android.openUrl).toBe(post.url);
    expect(serverMustNotPublishReplies()).toBe(true);
  });

  it("uses numeric author id for X DMs, otherwise the profile", () => {
    expect(dmUrl({ ...post, authorId: "12345", authorHandle: "mira" })).toBe(
      "https://x.com/messages/compose?recipient_id=12345",
    );
    expect(dmUrl({ ...post, authorId: "mira", authorHandle: "mira" })).toBe("https://x.com/mira");
  });

  it("contains no server-side reply publish path in LiveRound source", () => {
    const root = join(__dirname, "../..");
    const files = walk(root);
    const banned = [
      /in_reply_to_tweet_id/,
      /replyTo\s*\(/,
      /XWriteClient/,
      /oauth\.reddit\.com\/api\/comment/,
    ];
    const hits: string[] = [];
    for (const file of files) {
      if (file.endsWith(".test.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (file.includes("ideas/publish.ts")) {
        if (/in_reply_to/.test(src) || /\breply\s*:/.test(src)) {
          hits.push(`${file} :: reply target on original-post publisher`);
        }
        continue;
      }
      if (/api\.x\.com\/2\/tweets/.test(src) && !file.includes("ideas/publish.ts")) {
        hits.push(`${file} :: api.x.com/2/tweets is only allowed in lib/ideas/publish.ts`);
      }
      for (const re of banned) {
        if (re.test(src)) hits.push(`${file} :: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
