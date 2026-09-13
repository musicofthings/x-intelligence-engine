# LiveRound

A human-in-the-loop growth cockpit for X and Reddit.

You sit down for about fifteen minutes. Matching conversations stream into a **one-card inbox**, with a reply already drafted in **your** voice. You Reply or Pass. LiveRound never publishes a reply. Speed is the feature. Five thoughtful replies beat twenty rushed ones.

This repository also contains the earlier Cloudflare **X Intelligence Engine** (D1, Workers, analyst dashboard). LiveRound is the product going forward: Next.js on Vercel, Neon Postgres, session-scoped scanning. Proven pieces from the engine — Reddit’s official API client, deterministic pre-send safety, voice-drafting prompt rules, AES-GCM token envelopes — are ported into `apps/liveround`.

## Human-press rule

**The server never posts a reply.** Approving a reply and publishing it are the same moment, in your X or Reddit session:

- Desktop X: official compose intent with `in_reply_to`, draft on the clipboard
- Android X: clipboard + open the post (X Android drops `in_reply_to` on incoming compose links)
- Reddit: clipboard + open the post

You then confirm “I posted it.” That writes the Reply Log. There is no X/Reddit write API for replies in this app. Scheduled **Post Ideas** (Phase 2) are the only server-side publish path, and only for original posts whose exact text you approved.

## Adapters

Discovery sits behind a `SocialAdapter` interface (`apps/liveround/src/lib/adapters`):

| Adapter | When |
| --- | --- |
| `MockXAdapter` | Default. Used whenever `X_CLIENT_ID` / `X_CLIENT_SECRET` are missing. Settings shows a banner — this is not production X. |
| `RedditAdapter` | Official Reddit OAuth (application-only). Validates subreddits on add. Falls back to a labelled demo card if keys are missing. |
| X production | Phase 2, same interface, only if keys exist. |

Scanning runs **only while a round is LIVE**. Paused and idle time are free. Posts older than 24 hours drop. Replied and passed cards never return.

## Stack

- Next.js App Router + TypeScript + Tailwind v4 + shadcn/ui primitives
- Neon Postgres + Drizzle (in-memory fallback when `DATABASE_URL` is unset — fine for local demo, not for multi-instance production)
- Auth.js (email magic link; Google if configured)
- Anthropic Messages API for score/draft/think-for-me (heuristic fallback if the key is missing)
- Vercel

## Local run

```bash
pnpm install
cp .env.example .env.local
# at minimum: AUTH_SECRET (any 32+ char string in dev)
pnpm --filter liveround dev
```

Open http://localhost:3000. Sign in with email — in development the magic link is shown on the page if Resend is not configured.

```bash
pnpm --filter liveround test
pnpm --filter liveround typecheck
pnpm --filter liveround build
```

## Neon

Set `DATABASE_URL` to a Neon connection string, then:

```bash
pnpm --filter liveround db:push
# or apply apps/liveround/drizzle/0001_init.sql in the Neon SQL editor
```

Without `DATABASE_URL`, LiveRound keeps state in the server process. That resets on restart and does not survive Vercel serverless.

## Deploy to Vercel

1. Create a Vercel project on this repo.
2. Set **Root Directory** to `apps/liveround`.
3. Add env vars from `.env.example` (at least `AUTH_SECRET`, `AUTH_URL`, and `DATABASE_URL` for persistence).
4. Run the Drizzle SQL on Neon before the first production login.
5. Preview deploys pick up pull requests automatically.

## Credits

Two pools: plan credits (reset with the billing period) and permanent credits (never expire). Spend plan first. Start requires a small balance. Ticks are **one credit per minute of LIVE time**, keyed by `sessionId + minute` so reconnects do not double-charge. Heartbeats while paused do not tick.

New accounts get a 7-day trial and 50 plan credits so a founder can run a round tomorrow.

## Legacy engine

`apps/api-worker`, `apps/pipeline-worker`, `apps/web`, and `packages/*` remain the Cloudflare intelligence pipeline. See the previous README section in git history, `AGENTS.md` (legacy rules), and `docs/` if you still operate that stack. Do not add a server-side reply send path to LiveRound to “match” the old engage worker.

## License

Private.
