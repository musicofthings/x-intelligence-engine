import { describe, expect, it } from "vitest";
import { originalPostPayload, payloadIsOriginalOnly, publishOriginalPost } from "./publish";

describe("original post publisher", () => {
  it("payload is exactly { text } — never a reply target", () => {
    const payload = originalPostPayload("A standalone thought from a round.");
    expect(payload).toEqual({ text: "A standalone thought from a round." });
    expect(payloadIsOriginalOnly(payload)).toBe(true);
    expect("reply" in payload).toBe(false);
  });

  it("POSTs { text } only", async () => {
    let sent = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = String(init?.body ?? "");
      return new Response(JSON.stringify({ data: { id: "1" } }), { status: 201 });
    };
    await publishOriginalPost("tok", "Hello from LiveRound", fetchImpl);
    expect(JSON.parse(sent)).toEqual({ text: "Hello from LiveRound" });
    expect(sent).not.toMatch(/in_reply_to/);
    expect(sent).not.toMatch(/"reply"/);
  });
});
