import { describe, expect, it } from "vitest";
import { contactsFromLogs, reciprocalScore } from "./score";
import type { ReplyLogEntry } from "@/lib/types";

describe("contacts", () => {
  it("does not create a contact from a single outbound reply", () => {
    expect(reciprocalScore(1, 0)).toBeNull();
    expect(reciprocalScore(4, 0)).toBeNull();
    expect(reciprocalScore(2, 1)).toBeGreaterThan(0);
  });

  it("requires inbound evidence in the last 30 days", () => {
    const now = Date.parse("2026-09-13T12:00:00.000Z");
    const logs: ReplyLogEntry[] = [
      {
        id: "log_1",
        userId: "usr_1",
        sessionId: "ses_1",
        cardId: "crd_1",
        network: "x",
        externalPostId: "mira_builds:123",
        body: "hello",
        confirmedAt: new Date(now - 3600_000).toISOString(),
      },
    ];
    expect(contactsFromLogs("usr_1", logs, [], now)).toHaveLength(0);
    const contacts = contactsFromLogs(
      "usr_1",
      logs,
      [{ network: "x", handle: "mira_builds", at: new Date(now - 1800_000).toISOString() }],
      now,
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.handle).toBe("mira_builds");
  });
});
