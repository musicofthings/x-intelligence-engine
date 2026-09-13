import type { Campaign, InboxCard, MatchScore, SocialPost } from "@/lib/types";
import { overlapScore, similarity } from "@/lib/writing/text";

export function humanScore(value: number): string {
  if (value >= 0.82) return "Strong match — this is the conversation you described.";
  if (value >= 0.68) return "Worth a look — close to the filter, not a stretch.";
  if (value >= 0.55) return "Possible — related, but a little off-center.";
  return "Weak — pass unless something specific catches you.";
}

export function scorePost(post: SocialPost, campaign: Campaign, passedBodies: string[]): MatchScore {
  const docs = [campaign.filterDoc, campaign.building, campaign.reaching, campaign.strategyX, campaign.strategyReddit]
    .filter(Boolean)
    .join("\n");
  let value = 0.42 + overlapScore(docs, post.body) * 2.2;
  const ageH = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  if (ageH < 1) value += 0.12;
  else if (ageH < 6) value += 0.06;
  const heat = post.metrics.replies + post.metrics.likes / 20;
  if (heat > 20) value += 0.05;
  for (const prev of passedBodies.slice(0, 20)) {
    if (similarity(post.body, prev) > 0.45) value -= 0.18;
  }
  value = Math.max(0.05, Math.min(0.97, value));
  return {
    value,
    label: humanScore(value),
    rationale: value >= 0.68 ? "Filter overlap + freshness." : "Partial overlap with the campaign docs.",
  };
}

export function rankCards(cards: InboxCard[]): InboxCard[] {
  return [...cards].sort((a, b) => {
    if (b.score.value !== a.score.value) return b.score.value - a.score.value;
    return b.post.createdAt.localeCompare(a.post.createdAt);
  });
}

export const SCORE_THRESHOLD = 0.52;
