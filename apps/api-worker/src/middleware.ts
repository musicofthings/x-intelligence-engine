import type { MiddlewareHandler } from "hono";
import { loadEnv, allowedEmails } from "@xie/config";
import { Repositories } from "@xie/db";
import { createLogger, AppError, isAppError, toAppError } from "@xie/shared";
import type { HonoEnv, Bindings } from "./bindings.js";
import { verifyAccessJwt, fetchJwks, accessIssuer } from "./access.js";

/** Build env/repos/logger and attach a request id (spec §34, §35). */
export const contextMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const env = loadEnv(c.env as unknown as Record<string, unknown>);
  const requestId = crypto.randomUUID();
  const logger = createLogger({
    service: "x-intelligence-api",
    environment: env.APP_ENV,
    level: env.LOG_LEVEL,
    bound: { request_id: requestId },
  });
  c.set("env", env);
  c.set("requestId", requestId);
  c.set("logger", logger);
  c.set("repo", new Repositories(c.env.DB));
  c.set("actor", null);
  await next();
};

/** Secure headers + CORS (spec §25, §26). No wildcard CORS for authed endpoints. */
export const securityMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const env = c.get("env");
  const origin = c.req.header("origin");
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (origin && origin === env.WEB_ORIGIN) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Cf-Access-Jwt-Assertion");
  }
};

/**
 * Authentication (spec §24). Production verifies Cloudflare Access identity from the
 * `Cf-Access-Authenticated-User-Email` / JWT headers and enforces ALLOWED_EMAILS.
 * development mode bypasses auth and is refused in production (enforced in loadEnv).
 */
export const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const env = c.get("env");
  if (env.AUTH_MODE === "development" && env.APP_ENV !== "production") {
    c.get("logger").warn("auth.dev_bypass", { event: "auth.dev_bypass" });
    c.set("actor", "dev@localhost");
    return next();
  }
  // Production: cryptographically verify the Cloudflare Access JWT. We do NOT trust the
  // Cf-Access-Authenticated-User-Email header on its own (it could be spoofed on a
  // directly-reachable worker). Requires CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD.
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    throw new AppError("CONFIGURATION_ERROR", "Cloudflare Access is not configured");
  }
  const token =
    c.req.header("Cf-Access-Jwt-Assertion") ?? cookieValue(c.req.header("cookie"), "CF_Authorization");
  if (!token) throw new AppError("AUTHENTICATION_ERROR");

  const nowMs = Date.now();
  const jwks = await fetchJwks(env.CF_ACCESS_TEAM_DOMAIN, nowMs);
  const { email } = await verifyAccessJwt(token, {
    jwks,
    aud: env.CF_ACCESS_AUD,
    issuer: accessIssuer(env.CF_ACCESS_TEAM_DOMAIN),
    allowedEmails: allowedEmails(env),
    nowSec: Math.floor(nowMs / 1000),
  });
  c.set("actor", email);
  return next();
};

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** Consistent error envelope; never leaks stack/detail to clients (spec §34). */
export const errorHandler = (err: Error, c: { get: (k: "logger") => ReturnType<typeof createLogger>; get2?: unknown } & any) => {
  const appErr: AppError = isAppError(err) ? err : toAppError(err);
  const requestId = c.get("requestId") as string | undefined;
  try {
    c.get("logger").error("request.error", { error_code: appErr.code, event: "request.error", detail: JSON.stringify(appErr.detail ?? {}) });
  } catch {
    /* logger not ready */
  }
  return c.json(appErr.toPublic(requestId), appErr.status as 400);
};
