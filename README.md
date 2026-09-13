# LiveRound

A 15-minute lightning round for X and Reddit. Matching posts stream into a one-card
inbox. A reply is drafted in your voice. **You** press send. LiveRound never does.

Product app: [`apps/liveround`](./apps/liveround). Start there.

```bash
pnpm install
cp .env.example .env.local
pnpm --filter liveround dev
```

- **Human-press rule** — the server has no reply-publish API. Compose deep-link or clipboard only.
- **Adapters** — Reddit official API; X uses `MockXAdapter` until `X_CLIENT_ID`/`SECRET` exist.
- **Credits** — tick only while LIVE, one credit per minute, plan pool then permanent.
- **Deploy** — Vercel root directory `apps/liveround`. Neon `DATABASE_URL` for persistence.

Full runbook, env list, and architecture: [`apps/liveround/README.md`](./apps/liveround/README.md).

This repo also holds the earlier Cloudflare **X Intelligence Engine** (`apps/api-worker`,
`apps/web`, `packages/*`). It is not the LiveRound product surface.
