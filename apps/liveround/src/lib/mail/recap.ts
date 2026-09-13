import { env } from "@/lib/env";

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  if (!env.resendKey) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.resendKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.resendFrom,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });
  return res.ok;
}

export function recapEmail(input: {
  replies: number;
  posted: number;
  credits: number;
  topic?: string;
}): { subject: string; text: string } {
  const bits = [];
  if (input.replies) bits.push(`${input.replies} ${input.replies === 1 ? "reply" : "replies"} logged`);
  if (input.posted) bits.push(`${input.posted} original ${input.posted === 1 ? "post" : "posts"} sent`);
  const subject = bits.length ? `Yesterday: ${bits.join(", ")}` : "Yesterday: a quiet day";
  const text = [
    bits.length ? bits.join(". ") + "." : "No replies or original posts yesterday.",
    "",
    `${input.credits} credits remaining.`,
    "",
    "Idle and reading stay free. Credits meter only LIVE scan time.",
  ].join("\n");
  return { subject, text };
}

export function missedQueueEmail(input: { count: number; topic: string }): { subject: string; text: string } {
  const subject = `${input.count} matching ${input.count === 1 ? "post" : "posts"} on ${input.topic} waiting`;
  const text = [
    `${input.count} cards were sitting in a paused round.`,
    `Topic: ${input.topic}.`,
    "",
    "Resume the round when you have fifteen minutes. We do not reply for you.",
  ].join("\n");
  return { subject, text };
}
