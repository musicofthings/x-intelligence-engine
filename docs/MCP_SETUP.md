# MCP Server Setup

The remote MCP server exposes the **local intelligence database** (never the live X API)
to Claude Code and other authorized MCP clients.

## Endpoint & auth

- URL: `https://<api-domain>/mcp` (JSON-RPC 2.0 over HTTP POST).
- Auth: `Authorization: Bearer <MCP_API_TOKEN>` — compared in constant time. The token is
  a Worker secret and is never exposed to the browser.
- Read-only by default. Mutating tools require `MCP_ALLOW_MUTATIONS=true`.

## Tools

Read-only: `search_x_posts`, `get_x_post`, `get_x_thread`, `get_recent_signals`,
`get_top_x_signals`, `list_monitors`, `get_monitor_status`, `get_latest_digest`,
`search_authors`.

Guarded (only when `MCP_ALLOW_MUTATIONS=true`): `run_monitor` — **can incur X API and
Claude costs**; this is stated in the tool metadata.

All post content returned is labelled UNTRUSTED external data. Secrets, config, and stack
traces are never returned (spec §23).

## Connect from Claude Code

Add the remote MCP server (confirm exact flags against current Claude Code docs):

```bash
claude mcp add --transport http xie https://<api-domain>/mcp \
  --header "Authorization: Bearer <MCP_API_TOKEN>"
```

Then, in a session:

```
Use the xie MCP server. Call get_recent_signals with hours=48 and min_score=75.
```

## Example raw JSON-RPC call

```bash
curl -s https://<api-domain>/mcp \
  -H "Authorization: Bearer <MCP_API_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"get_recent_signals","arguments":{"hours":48,"min_score":75}}}'
```

## Rotate the token

```powershell
wrangler secret put MCP_API_TOKEN --config apps/api-worker/wrangler.jsonc
```

Old tokens stop working immediately after rotation. Update every connected client.

## Enable the mutation tool (deliberate)

Set `MCP_ALLOW_MUTATIONS=true` in `apps/api-worker/wrangler.jsonc` vars and redeploy.
Leave it `false` unless you explicitly want MCP clients to trigger paid live runs.
