import { describe, it, expect } from "vitest";
import { Repositories } from "@xie/db";
import { createTestDb } from "../../db/test/adapter.js";
import { handleMcpRequest } from "./server.js";
import { availableTools } from "./tools.js";
import type { McpDeps } from "./tools.js";

const NOW = Date.parse("2026-07-07T12:00:00Z");

function deps(allowMutations = false): { d: McpDeps } {
  const { d1 } = createTestDb();
  const repo = new Repositories(d1, { nowIso: () => "2026-07-07T00:00:00Z" }, { next: (p) => `${p}_x` });
  return { d: { repo, db: d1, nowMs: NOW, allowMutations } };
}

describe("mcp read-only default", () => {
  it("hides run_monitor unless mutations enabled", () => {
    expect(availableTools(false).some((t) => t.name === "run_monitor")).toBe(false);
    expect(availableTools(true).some((t) => t.name === "run_monitor")).toBe(true);
  });

  it("initialize returns protocol + server info", async () => {
    const { d } = deps();
    const res = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, d);
    expect((res.result as { serverInfo: { name: string } }).serverInfo.name).toBe("x-intelligence-engine");
  });

  it("tools/list excludes mutating tool by default", async () => {
    const { d } = deps();
    const res = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, d);
    const names = (res.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain("get_recent_signals");
    expect(names).not.toContain("run_monitor");
  });
});

describe("mcp input validation", () => {
  it("rejects out-of-range search input", async () => {
    const { d } = deps();
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_x_posts", arguments: { query: "ai", days: 9999 } } },
      d,
    );
    const payload = JSON.parse((res.result as { content: { text: string }[] }).content[0]!.text);
    expect((res.result as { isError: boolean }).isError).toBe(true);
    expect(payload.error).toBeTruthy();
  });

  it("returns unknown-tool error", async () => {
    const { d } = deps();
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } },
      d,
    );
    expect(res.error?.code).toBe(-32601);
  });

  it("run_monitor is blocked when mutations disabled", async () => {
    const { d } = deps(false);
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "run_monitor", arguments: { monitor_id: "x" } } },
      d,
    );
    // Tool not available -> unknown tool error
    expect(res.error?.code).toBe(-32601);
  });

  it("search labels content untrusted and returns no secrets", async () => {
    const { d } = deps();
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search_x_posts", arguments: { query: "ai" } } },
      d,
    );
    const text = (res.result as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain("UNTRUSTED");
    expect(text.toLowerCase()).not.toContain("api_key");
    expect(text.toLowerCase()).not.toContain("bearer");
  });
});
