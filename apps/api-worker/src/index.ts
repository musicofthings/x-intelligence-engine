import { Hono } from "hono";
import type { HonoEnv, Bindings } from "./bindings.js";
import { contextMiddleware, securityMiddleware, authMiddleware, errorHandler } from "./middleware.js";
import { apiRoutes } from "./routes.js";
import { mcpRoutes } from "./mcp.js";
import { webhookRoutes } from "./webhook.js";

/** API Worker entrypoint (spec §3.2). */
const app = new Hono<HonoEnv>();

app.use("*", contextMiddleware);
app.use("*", securityMiddleware);
app.onError(errorHandler as never);

app.options("*", (c) => c.body(null, 204));

// Health — lightweight, unauthenticated, no paid calls (spec §63).
app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "x-intelligence-api",
    version: c.get("env").APP_VERSION,
    environment: c.get("env").APP_ENV,
    timestamp: new Date().toISOString(),
  }),
);

// Deep health — authenticated; checks D1 + config presence, no paid calls.
app.get("/api/health/deep", authMiddleware, async (c) => {
  const env = c.get("env");
  let dbOk = true;
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    dbOk = false;
  }
  return c.json({
    status: dbOk ? "ok" : "degraded",
    checks: {
      db: dbOk,
      x_configured: !!env.X_BEARER_TOKEN,
      claude_configured: !!env.ANTHROPIC_API_KEY && !!env.ANTHROPIC_MODEL,
      mcp_configured: !!env.MCP_API_TOKEN,
    },
  });
});

// Webhook (its own signature auth) and MCP (its own bearer auth) — mounted before the
// broad authMiddleware so they use their dedicated auth schemes.
app.route("/api/webhooks", webhookRoutes());
app.route("/mcp", mcpRoutes());

// Everything else under /api requires Cloudflare Access auth.
app.use("/api/*", authMiddleware);
app.route("/api", apiRoutes());

export default app satisfies { fetch: (req: Request, env: Bindings, ctx: ExecutionContext) => Response | Promise<Response> };
