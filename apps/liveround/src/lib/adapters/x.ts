import { env, xSearchConfigured } from "@/lib/env";
import type { AdapterDiscoverInput, SocialAdapter, SocialPost } from "@/lib/types";
import { recentSearch, tweetsToPosts } from "@/lib/x/search";

/**
 * Official X API v2 adapter. Used when X_CLIENT_ID/SECRET or X_BEARER_TOKEN is set.
 * HUMAN PRESS RULE: no reply writes live here. Original posts go through lib/ideas/publish.ts only.
 */
export class ProductionXAdapter implements SocialAdapter {
  id = "x" as const;
  network = "x" as const;
  label = "X";

  get configured() {
    return xSearchConfigured();
  }

  async discover(input: AdapterDiscoverInput): Promise<SocialPost[]> {
    const token = input.accessToken || env.xBearer;
    if (!token) {
      throw new Error("X search token missing. Connect X in Settings or set X_BEARER_TOKEN.");
    }
    const rules = input.campaign.searchRules.map((r) => r.query.trim()).filter(Boolean);
    if (rules.length === 0) return [];
    const per = Math.max(10, Math.ceil(Math.min(100, input.limit * 2) / rules.length));
    const posts: SocialPost[] = [];
    const seen = new Set<string>();
    for (const rule of rules) {
      const body = await recentSearch(token, {
        query: `${rule} -is:retweet`,
        maxResults: per,
        startTime: input.sinceIso,
      });
      for (const post of tweetsToPosts(body)) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        posts.push(post);
      }
    }
    return posts.filter((p) => p.createdAt >= input.sinceIso).slice(0, input.limit);
  }
}

export const productionXAdapter = new ProductionXAdapter();
