import { describe, expect, it } from "vitest";
import { recapEmail, missedQueueEmail } from "./recap";

describe("recap email", () => {
  it("leads with results", () => {
    const mail = recapEmail({ replies: 4, posted: 1, credits: 41 });
    expect(mail.subject).toBe("Yesterday: 4 replies logged, 1 original post sent");
    expect(mail.text.startsWith("4 replies logged")).toBe(true);
  });

  it("states missed-queue count and topic in the subject", () => {
    const mail = missedQueueEmail({ count: 7, topic: "founders in public" });
    expect(mail.subject).toBe("7 matching posts on founders in public waiting");
  });
});
