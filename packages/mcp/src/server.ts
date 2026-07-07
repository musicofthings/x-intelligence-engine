import { availableTools, type McpDeps } from "./tools.js";

/**
 * Minimal MCP JSON-RPC 2.0 handler (spec §21). Transport is HTTP POST at /mcp; the
 * api-worker performs bearer authentication BEFORE calling this. Implements the core
 * methods: initialize, tools/list, tools/call.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const PROTOCOL_VERSION = "2024-11-05";

export async function handleMcpRequest(req: JsonRpcRequest, deps: McpDeps): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (req.method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "x-intelligence-engine", version: "0.1.0" },
        });

      case "notifications/initialized":
        return reply({});

      case "ping":
        return reply({});

      case "tools/list":
        return reply({
          tools: availableTools(deps.allowMutations).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case "tools/call": {
        const params = (req.params ?? {}) as { name?: string; arguments?: unknown };
        const tool = availableTools(deps.allowMutations).find((t) => t.name === params.name);
        if (!tool) return fail(-32601, `Unknown tool: ${params.name}`);
        try {
          const out = await tool.handler(deps, params.arguments ?? {});
          return reply({ content: [{ type: "text", text: JSON.stringify(out) }], isError: false });
        } catch (e) {
          // Tool errors return a safe message; never a stack trace (spec §23).
          const message = e instanceof Error ? e.message : "tool error";
          return reply({ content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true });
        }
      }

      default:
        return fail(-32601, `Method not found: ${req.method}`);
    }
  } catch {
    return fail(-32603, "Internal error");
  }
}
