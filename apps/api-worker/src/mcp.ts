import { Hono } from "hono";
import { handleMcpRequest, type JsonRpcRequest } from "@xie/mcp";
import type { D1Like } from "@xie/db";
import { constantTimeEqual } from "@xie/x-client";
import type { HonoEnv } from "./bindings.js";

/** Remote MCP endpoint (spec §21). Separate bearer auth; read-only by default. */
export function mcpRoutes(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.post("/", async (c) => {
    const env = c.get("env");
    const token = env.MCP_API_TOKEN;
    if (!token) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "MCP not configured" } }, 503);

    const auth = c.req.header("authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    // constant-time compare (spec §21)
    if (!presented || !constantTimeEqual(presented, token)) {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401);
    }

    let body: JsonRpcRequest;
    try {
      body = (await c.req.json()) as JsonRpcRequest;
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }

    const res = await handleMcpRequest(body, {
      repo: c.get("repo"),
      db: c.env.DB as unknown as D1Like,
      nowMs: Date.now(),
      allowMutations: env.MCP_ALLOW_MUTATIONS,
    });
    return c.json(res);
  });

  return app;
}
