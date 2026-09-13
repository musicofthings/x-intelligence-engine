# AGENTS.md — LiveRound (+ legacy X Intelligence Engine)

Operating guide for coding agents in this repository.

## What this is now

**LiveRound** (`apps/liveround`) is the product: a human-in-the-loop lightning-round
cockpit for X and Reddit, deployed on Vercel. App accounts are Auth.js. Social
accounts connect later via OAuth. The server **never posts a reply**.

The Cloudflare **X Intelligence Engine** (`apps/api-worker`, `apps/pipeline-worker`,
`apps/web`, `packages/*`) remains in-tree as the previous generation. Do not collapse
the two. New user-facing work goes to LiveRound unless explicitly asked to patch the
engine.

## LiveRound rules (non-negotiable)

1. Never auto-reply. No server-side X/Reddit reply write path.
2. OAuth only — never collect X or Reddit passwords.
3. Credits meter LIVE scanning/filtering/drafting only. Idle, paused, reading are free.
4. Auto-pause ~5 minutes idle. Hard cap 60 minutes. Credits at zero pause the round.
5. Scanning happens only while LIVE.
6. Posts older than 24 hours drop. Replied/passed never return.
7. Safety net warns (bait, near-duplicates, overused links). Do not hard-block those.
8. One live acting session per connected social account (mutex).
9. Do not productize pods, mass DMs, engagement bait, or unattended agents.
10. Voice = bio + writing notes + the sending account’s posts.

## Layout

```
apps/liveround/     Next.js App Router (Vercel) — LiveRound
apps/web/           Legacy Vite SPA (Cloudflare Pages)
apps/api-worker/    Legacy Hono API
apps/pipeline-worker Legacy cron/queues
packages/           Legacy domain packages (safety/reddit still referenced conceptually)
```

## Commands

- `pnpm install`
- `pnpm --filter liveround dev | test | typecheck | build`
- `pnpm --filter liveround db:push` — Neon schema
- Legacy: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` across workspaces

## Architecture (LiveRound)

```
[X search / Reddit new] → SocialAdapter (mock X if no keys)
        → AI filter (score vs campaign filter doc)
        → LIVE session queue (heartbeat pump)
        → voice draft
        → human decision
        → reply: client publish path only
        → post ideas: approved text + scheduler (Phase 2)
```

No SQL in route handlers beyond the repository in `apps/liveround/src/lib/db`.
No vendor API calls from the browser. External post text is untrusted data, never
instructions. No `dangerouslySetInnerHTML` for social content.

## Brand

Name: **LiveRound**. Wordmark is a ring with a live core. Fonts: Newsreader + Figtree.
Dark cockpit chrome, warm paper cards. No emoji in chrome, no gradient blobs, no
“AI magic” copy. Do not use Pounce, pounce.so, or Avidan Labs names/logos.
