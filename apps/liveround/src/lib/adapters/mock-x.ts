import type { AdapterDiscoverInput, SocialAdapter, SocialPost } from "@/lib/types";

const AUTHORS = [
  { handle: "mira_builds", name: "Mira Chen" },
  { handle: "arjun_lab", name: "Arjun Iyer" },
  { handle: "nola.codes", name: "Nola Reyes" },
  { handle: "kitwalker", name: "Kit Walker" },
  { handle: "sasha_notes", name: "Sasha Holm" },
  { handle: "devon.works", name: "Devon Park" },
];

const CORPUS: { body: string; likes: number; replies: number }[] = [
  {
    body: "Anyone else finding that inbound is mostly people who saw a comment, not a launch post? Wondering if I should stop treating original posts as the growth engine.",
    likes: 42,
    replies: 11,
  },
  {
    body: "Looking for a way to join live conversations on X without living in the feed. Saved searches rot. The native timeline is a slot machine. What are you actually using?",
    likes: 87,
    replies: 23,
  },
  {
    body: "We spent a week scheduling threads and grew 12 followers. One honest reply under a founder's question led to a 40-minute call. Distribution is happening in comments.",
    likes: 156,
    replies: 31,
  },
  {
    body: "Hiring a founding engineer who cares about genomics tooling. Not looking for a growth-hack account. If you've shipped something small and real, I want to talk.",
    likes: 64,
    replies: 18,
  },
  {
    body: "What's a good subreddit + X combo for talking to people who are already evaluating lab software? I keep showing up a day late.",
    likes: 19,
    replies: 7,
  },
  {
    body: "Hot take: five thoughtful replies beat twenty rushed ones. The accounts that feel human are the ones that pass more than they post.",
    likes: 210,
    replies: 44,
  },
  {
    body: "If your product helps founders spend 15 focused minutes a day instead of an hour of doomscrolling, I want a demo. That's the actual job.",
    likes: 33,
    replies: 9,
  },
  {
    body: "Can someone recommend a human-in-the-loop tool for Reddit + X? Auto-reply bots keep getting accounts flagged. I will press send myself.",
    likes: 71,
    replies: 16,
  },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function matchesRules(body: string, rules: string[]): boolean {
  if (rules.length === 0) return true;
  const hay = body.toLowerCase();
  return rules.some((r) =>
    r
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2 && !["the", "and", "for", "with"].includes(t))
      .some((t) => hay.includes(t.replace(/["']/g, ""))),
  );
}

/**
 * Mock X adapter. Used when X_CLIENT_ID/SECRET are missing.
 * Never claims to be production X. Cards are clearly labelled in the UI.
 *
 * HUMAN PRESS RULE: this adapter has no write methods. Replies are not posted here.
 */
export class MockXAdapter implements SocialAdapter {
  id = "mock_x" as const;
  network = "x" as const;
  label = "X (mock)";
  configured = true;

  async discover(input: AdapterDiscoverInput): Promise<SocialPost[]> {
    const rules = input.campaign.searchRules.map((r) => r.query);
    const now = Date.now();
    const posts: SocialPost[] = [];
    for (let i = 0; i < CORPUS.length; i++) {
      const row = CORPUS[i]!;
      if (!matchesRules(row.body, rules) && rules.length > 0) {
        // still include a couple so the queue is never a dead end during setup
        if (i > 2) continue;
      }
      const author = AUTHORS[(hash(row.body + input.campaign.id) + i) % AUTHORS.length]!;
      const ageMin = 4 + (hash(row.body) % 90);
      const created = now - ageMin * 60_000;
      const id = String(10_000_000_000_000 + (hash(row.body + author.handle) % 1_000_000_000));
      posts.push({
        network: "x",
        adapter: "mock_x",
        id,
        url: `https://x.com/${author.handle}/status/${id}`,
        authorId: author.handle,
        authorHandle: author.handle,
        authorName: author.name,
        body: row.body,
        createdAt: new Date(created).toISOString(),
        conversationId: id,
        authorFollowers: 80 + (hash(author.handle) % 12_000),
        metrics: {
          likes: row.likes,
          replies: row.replies,
          reposts: Math.floor(row.likes / 8),
          saves: Math.floor(row.likes / 12),
          comments: row.replies,
        },
        media: [],
      });
    }
    return posts.filter((p) => p.createdAt >= input.sinceIso).slice(0, input.limit);
  }
}

export const mockXAdapter = new MockXAdapter();

/** Local volume estimate from the mock corpus — not production X. */
export function countMockMatches(query: string): number {
  return CORPUS.filter((row) => matchesRules(row.body, [query])).length;
}
