import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv, capabilities } from "@xie/config";

/**
 * Guards the *deployed* configuration, not just the code.
 *
 * `loadEnv` refuses AUTH_MODE=development when APP_ENV=production, and an unset
 * AUTH_MODE defaults to "development". Because this worker runs `buildCtx` (and so
 * `loadEnv`) on every cron tick and every queue message, a wrangler.jsonc missing
 * AUTH_MODE while claiming production would throw on *every* invocation — silently
 * stopping the whole pipeline with nothing but CONFIGURATION_ERROR in the tail.
 *
 * These tests parse the real wrangler.jsonc so that failure mode is caught here rather
 * than in production.
 */

const here = dirname(fileURLToPath(import.meta.url));

function readWranglerVars(app: string): Record<string, string> {
  const raw = readFileSync(join(here, "..", "..", app, "wrangler.jsonc"), "utf8");
  // Strip // line comments (JSONC) without touching "https://…" inside strings.
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  const parsed = JSON.parse(stripped) as { vars?: Record<string, string>; workers_dev?: boolean };
  return parsed.vars ?? {};
}

function readWranglerConfig(app: string): { vars?: Record<string, string>; workers_dev?: boolean } {
  const raw = readFileSync(join(here, "..", "..", app, "wrangler.jsonc"), "utf8");
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));
}

describe("pipeline-worker deployed config", () => {
  const vars = readWranglerVars("pipeline-worker");

  it("boots loadEnv without throwing", () => {
    // The exact call buildCtx makes on every cron tick and queue message.
    expect(() => loadEnv(vars)).not.toThrow();
  });

  it("declares production, not development", () => {
    const env = loadEnv(vars);
    expect(env.APP_ENV).toBe("production");
    expect(env.APP_VERSION).not.toBe("local");
  });

  it("sets AUTH_MODE so the production guardrail is satisfied", () => {
    // Removing it must fail loudly here rather than at 00:15 in production.
    const { AUTH_MODE, ...withoutAuthMode } = vars;
    expect(AUTH_MODE).toBeDefined();
    expect(() => loadEnv(withoutAuthMode)).toThrow(/AUTH_MODE=development is refused/);
  });

  it("never enables demo mode in production", () => {
    expect(capabilities(loadEnv(vars)).demoMode).toBe(false);
  });

  it("keeps the open workers.dev hostname off", () => {
    // This worker exports no fetch handler; workers.dev would be an unauthenticated
    // internet-facing endpoint on a worker holding the D1 binding.
    expect(readWranglerConfig("pipeline-worker").workers_dev).toBe(false);
  });
});

describe("api-worker deployed config", () => {
  const vars = readWranglerVars("api-worker");

  it("boots loadEnv without throwing", () => {
    expect(() => loadEnv(vars)).not.toThrow();
  });

  it("runs production with Cloudflare Access, not dev auth", () => {
    const env = loadEnv(vars);
    expect(env.APP_ENV).toBe("production");
    expect(env.AUTH_MODE).toBe("cloudflare_access");
  });

  it("keeps the open workers.dev hostname off", () => {
    expect(readWranglerConfig("api-worker").workers_dev).toBe(false);
  });

  it("points the OAuth callback at the app's own origin", () => {
    const env = loadEnv(vars);
    // X rejects the exchange if the redirect_uri differs at all from the registered one,
    // and a callback on a foreign origin would leak the authorization code.
    expect(env.X_OAUTH_REDIRECT_URI).toBe(`${env.WEB_ORIGIN}/api/oauth/x/callback`);
  });
});
