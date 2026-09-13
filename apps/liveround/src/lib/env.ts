function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function bool(name: string): boolean {
  const v = optional(name);
  return v === "1" || v === "true" || v === "yes";
}

export function appUrl(): string {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export function authSecret(): string {
  const secret = optional("AUTH_SECRET");
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "liveround-dev-secret-not-for-production";
  throw new Error("AUTH_SECRET is required in production");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: optional("DATABASE_URL"),
  anthropicKey: optional("ANTHROPIC_API_KEY"),
  anthropicModel: optional("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
  redditClientId: optional("REDDIT_CLIENT_ID"),
  redditClientSecret: optional("REDDIT_CLIENT_SECRET"),
  redditUserAgent: optional("REDDIT_USER_AGENT") ?? "LiveRound/0.1 (human-in-the-loop engagement cockpit)",
  redditRedirect: optional("REDDIT_REDIRECT_URI"),
  xClientId: optional("X_CLIENT_ID"),
  xClientSecret: optional("X_CLIENT_SECRET"),
  xBearer: optional("X_BEARER_TOKEN"),
  xRedirect: optional("X_OAUTH_REDIRECT_URI"),
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  resendKey: optional("RESEND_API_KEY"),
  resendFrom: optional("EMAIL_FROM") ?? "LiveRound <noreply@localhost>",
  stripeSecret: optional("STRIPE_SECRET_KEY"),
  stripeWebhook: optional("STRIPE_WEBHOOK_SECRET"),
  stripePrices: {
    scoutMonth: optional("STRIPE_PRICE_SCOUT_MONTH"),
    scoutYear: optional("STRIPE_PRICE_SCOUT_YEAR"),
    hunterMonth: optional("STRIPE_PRICE_HUNTER_MONTH"),
    hunterYear: optional("STRIPE_PRICE_HUNTER_YEAR"),
    apexMonth: optional("STRIPE_PRICE_APEX_MONTH"),
    apexYear: optional("STRIPE_PRICE_APEX_YEAR"),
    pack50: optional("STRIPE_PRICE_PACK_50"),
    pack200: optional("STRIPE_PRICE_PACK_200"),
    pack500: optional("STRIPE_PRICE_PACK_500"),
    pack1800: optional("STRIPE_PRICE_PACK_1800"),
  },
  sentryDsn: optional("SENTRY_DSN"),
  tokenKey: optional("TOKEN_ENCRYPTION_KEY"),
  cronSecret: optional("CRON_SECRET"),
  allowDevLogin: bool("AUTH_DEV_LOGIN") || (process.env.NODE_ENV !== "production"),
};

export function redditConfigured(): boolean {
  return Boolean(env.redditClientId && env.redditClientSecret);
}

export function xConfigured(): boolean {
  return Boolean(env.xClientId && env.xClientSecret);
}

export function anthropicConfigured(): boolean {
  return Boolean(env.anthropicKey);
}

export function stripeConfigured(): boolean {
  return Boolean(env.stripeSecret);
}

export function googleConfigured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function xSearchConfigured(): boolean {
  return xConfigured() || Boolean(env.xBearer);
}

export function xRedirectUri(): string {
  return env.xRedirect ?? `${appUrl()}/api/oauth/x/callback`;
}

export function cronAuthorized(req: Request): boolean {
  const vercel = req.headers.get("x-vercel-cron");
  if (vercel === "1") return true;
  const secret = env.cronSecret;
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  if (!secret && env.nodeEnv !== "production") return true;
  return false;
}
