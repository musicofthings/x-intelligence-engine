import { env } from "@/lib/env";
import type { PostIdea, ReplyLogEntry, VoiceProfile, WritingSettings } from "@/lib/types";
import { IDEA_EXPIRE_DAYS, IDEA_DISTILL_MIN_REPLIES, X_CHAR_LIMIT } from "@/lib/types";
import { saveIdea } from "@/lib/db/store-phase2";
import { newId, nowIso } from "@/lib/utils";

function standaloneFromReply(body: string): string {
  const cleaned = body
    .replace(/^@\w+\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  const idea = sentence.replace(/^(that|this|the) (bit|line|part) /i, "");
  return idea.slice(0, X_CHAR_LIMIT);
}

function heuristicIdeas(replies: ReplyLogEntry[], sessionId: string, userId: string): PostIdea[] {
  const unique: string[] = [];
  for (const r of replies) {
    const text = standaloneFromReply(r.body);
    if (text.length < 40) continue;
    if (unique.some((u) => u.slice(0, 40) === text.slice(0, 40))) continue;
    unique.push(text);
    if (unique.length >= 5) break;
  }
  const now = Date.now();
  return unique.map((text) => ({
    id: newId("ide"),
    userId,
    sessionId,
    text,
    status: "draft" as const,
    failReason: null,
    scheduledAt: null,
    postedAt: null,
    externalPostId: null,
    createdAt: nowIso(now),
    expiresAt: nowIso(now + IDEA_EXPIRE_DAYS * 24 * 60 * 60 * 1000),
  }));
}

async function claudeIdeas(
  replies: ReplyLogEntry[],
  voice: VoiceProfile,
  writing: WritingSettings,
): Promise<string[]> {
  if (!env.anthropicKey) return [];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 800,
      system:
        "You distill a founder's own replies into standalone original posts. Use THEIR words. Do not invent claims. Return JSON array of 3-5 strings, each under 280 characters. No markdown.",
      messages: [
        {
          role: "user",
          content: `<voice>\n${writing.bio}\n${writing.writingNotes}\n${voice.samplePosts.slice(0, 5).join("\n")}\n</voice>\n<replies>\n${replies
            .slice(0, 20)
            .map((r) => r.body)
            .join("\n---\n")}\n</replies>`,
        },
      ],
    }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = body.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string").map((s) => s.trim().slice(0, X_CHAR_LIMIT));
  } catch {
    return [];
  }
}

export async function distillPostIdeas(input: {
  userId: string;
  sessionId: string;
  replies: ReplyLogEntry[];
  voice: VoiceProfile;
  writing: WritingSettings;
}): Promise<PostIdea[]> {
  const xReplies = input.replies.filter((r) => r.network === "x" && r.sessionId === input.sessionId);
  if (xReplies.length < IDEA_DISTILL_MIN_REPLIES) return [];
  const fromClaude = await claudeIdeas(xReplies, input.voice, input.writing);
  const ideas = fromClaude.length
    ? heuristicIdeas(
        fromClaude.map((text, i) => ({
          id: `tmp_${i}`,
          userId: input.userId,
          sessionId: input.sessionId,
          cardId: "",
          network: "x" as const,
          externalPostId: "",
          body: text,
          confirmedAt: nowIso(),
        })),
        input.sessionId,
        input.userId,
      )
    : heuristicIdeas(xReplies, input.sessionId, input.userId);
  for (const idea of ideas) await saveIdea(idea);
  return ideas;
}

export { IDEA_DISTILL_MIN_REPLIES };
