import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Stat, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import { timeAgo } from "../lib/format";
import type { EngageStats, XOAuthStatus } from "../lib/types";

/** Usage & Cost (spec §6.10). */
export function Usage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["usage"],
    queryFn: () => api.get<Envelope<{ x_resources_day: number; x_resources_month: number; estimated_x_cost_day_usd: number; claude_requests_day: number; note: string }>>("/usage/summary"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  const u = data!.data;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Usage &amp; Cost</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="X reads today" value={u.x_resources_day} />
        <Stat label="X reads 30d" value={u.x_resources_month} />
        <Stat label="Est. X cost today" value={`$${u.estimated_x_cost_day_usd.toFixed(2)}`} />
        <Stat label="Claude calls today" value={u.claude_requests_day} />
      </div>
      <p className="text-xs text-fg-subtle">{u.note}</p>
    </div>
  );
}

function Toggle({ on, label, hint, onToggle, danger }: { on: boolean; label: string; hint?: string; onToggle: () => void; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2">
      <div>
        <div className="text-sm text-fg">{label}</div>
        {hint && <div className="text-xs text-fg-subtle">{hint}</div>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? (danger ? "bg-amber-500" : "bg-teal-500") : "bg-elevated"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

/** Settings (spec §6.11, §30) — capability flags + automation switches. No secret values. */
export function Settings() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Envelope<{ settings: Record<string, unknown>; capabilities: Record<string, unknown> }>>("/settings"),
  });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch("/settings", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  const { settings, capabilities } = data!.data;
  const flag = (k: string, d = false) => (settings[k] === undefined ? d : Boolean(settings[k]));
  const interval = Number(settings["watchlist.poll_interval_minutes"] ?? 180);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Settings</h1>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-fg">Automation</h2>
        <p className="mb-2 text-xs text-fg-subtle">Master switches for scheduled jobs. Automatic collection is OFF by default — nothing runs unsupervised. "Run now" on a monitor always works regardless.</p>
        <Toggle
          on={flag("cron.collection_enabled")}
          label="Automatic collection (every 15 min)"
          hint="Cron-driven monitor + watchlist reads. This is the cost driver — leave off unless supervising."
          danger
          onToggle={() => save.mutate({ "cron.collection_enabled": !flag("cron.collection_enabled") })}
        />
        <Toggle
          on={flag("cron.reddit_enabled")}
          label="Automatic Reddit collection (every 15 min)"
          hint="Independent of X collection. Reddit's API is free; the cost is downstream Claude screening."
          danger
          onToggle={() => save.mutate({ "cron.reddit_enabled": !flag("cron.reddit_enabled") })}
        />
        <Toggle
          on={flag("cron.digest_enabled", true)}
          label="Daily digest (08:00 IST)"
          hint="Assembles stored intelligence into a digest. No X/Claude cost."
          onToggle={() => save.mutate({ "cron.digest_enabled": !flag("cron.digest_enabled", true) })}
        />
        <Toggle
          on={flag("cron.maintenance_enabled", true)}
          label="Daily maintenance"
          hint="Expires stuck runs, applies retention. No external cost."
          onToggle={() => save.mutate({ "cron.maintenance_enabled": !flag("cron.maintenance_enabled", true) })}
        />
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-sm text-fg">Watchlist poll interval (minutes)</div>
            <div className="text-xs text-fg-subtle">How often each watchlist account's timeline is read.</div>
          </div>
          <input
            type="number" min={15} max={1440} defaultValue={interval}
            onBlur={(e) => { const v = Number(e.target.value); if (v && v !== interval) save.mutate({ "watchlist.poll_interval_minutes": v }); }}
            className="w-24 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
          />
        </div>
      </Card>

      <ConnectedAccounts />

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-fg">Capabilities</h2>
        <ul className="space-y-1 text-sm">
          {Object.entries(capabilities).map(([k, v]) => (
            <li key={k} className="flex justify-between border-b border-line py-1">
              <span className="text-fg-muted">{k}</span>
              <span className="text-fg">{String(v)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-subtle">Secret values (X bearer, Anthropic key, MCP token) are never sent to the browser.</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-fg">Configuration</h2>
        <pre className="text-xs text-fg-muted">{JSON.stringify(settings, null, 2)}</pre>
      </Card>
    </div>
  );
}

/**
 * Connected accounts. Sending replies needs X user-context OAuth, which is a separate
 * credential from the app-only bearer token used for reads. Token material is never
 * sent to the browser — only the identity and expiry.
 */
function ConnectedAccounts() {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search).get("x_oauth");
    return p === "connected" ? "X account connected." : p === "denied" ? "Authorization was declined on X." : null;
  });

  const x = useQuery({
    queryKey: ["oauth-x"],
    queryFn: () => api.get<Envelope<XOAuthStatus>>("/oauth/x/status"),
  });
  const reddit = useQuery({
    queryKey: ["reddit-status"],
    queryFn: () => api.get<Envelope<{ configured: boolean; missing: string[] }>>("/reddit/status"),
  });

  const connect = useMutation({
    mutationFn: () => api.post<Envelope<{ authorize_url: string }>>("/oauth/x/start", {}),
    // Full-page navigation: X's consent screen refuses to render in an iframe.
    onSuccess: (r) => { window.location.href = r.data.authorize_url; },
    onError: (e) => setNote((e as Error).message),
  });
  const disconnect = useMutation({
    mutationFn: () => api.del("/oauth/x"),
    onSuccess: () => { setNote("X account disconnected."); qc.invalidateQueries({ queryKey: ["oauth-x"] }); },
  });

  const s = x.data?.data;
  const r = reddit.data?.data;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-fg">Connected accounts</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Reading X uses the app-only bearer token. Sending replies needs a user-context OAuth connection.
      </p>
      {note && <div className="mb-3 rounded border border-line bg-elevated px-3 py-2 text-xs text-fg">{note}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2">
        <div>
          <div className="text-sm text-fg">X (sending)</div>
          <div className="text-xs text-fg-subtle">
            {!s ? "Checking…"
              : !s.configured ? `Not configured — missing ${s.missing.join(", ")}`
                : s.connected ? `Connected as @${s.username ?? "unknown"}${s.scope ? ` · ${s.scope}` : ""}`
                  : "Configured but no account connected."}
          </div>
        </div>
        {s?.configured && (
          s.connected
            ? <Button variant="danger" onClick={() => disconnect.mutate()}>Disconnect</Button>
            : <Button variant="primary" onClick={() => connect.mutate()} disabled={connect.isPending}>Connect X account</Button>
        )}
      </div>

      <div className="py-2">
        <div className="text-sm text-fg">Reddit (collection)</div>
        <div className="text-xs text-fg-subtle">
          {!r ? "Checking…" : r.configured ? "Configured." : `Not configured — missing ${r.missing.join(", ")}`}
        </div>
      </div>
    </Card>
  );
}

/** System health + maintenance (spec §6.12, §51). */
export function System() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["system"],
    queryFn: () => api.get<Envelope<Record<string, unknown>>>("/system/status"),
  });
  const stats = useQuery({
    queryKey: ["maintenance-stats"],
    queryFn: () => api.get<Envelope<Record<string, number>>>("/system/maintenance/stats"),
  });
  const [purgeDays, setPurgeDays] = useState(90);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["maintenance-stats"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const action = useMutation({
    mutationFn: (a: { path: string; body?: unknown; label: string }) =>
      api.post<Envelope<Record<string, unknown>>>(a.path, a.body).then((r) => ({ r, label: a.label })),
    onSuccess: ({ r, label }) => {
      const cleared = (r.data.deleted ?? r.data.reset ?? "done") as unknown;
      setNote(`${label}: ${typeof cleared === "number" ? `${cleared} rows` : "done"}`);
      refresh();
    },
    onError: (e) => setNote((e as Error).message),
  });

  const run = (path: string, label: string, confirmMsg: string, body?: unknown) => {
    if (!window.confirm(confirmMsg)) return;
    action.mutate({ path, body, label });
  };

  const resetAll = () => {
    const typed = window.prompt('This deletes ALL collected posts, screenings, alerts, digests, runs and usage. Monitors, watchlists and settings are kept.\n\nType RESET to confirm:');
    if (typed !== "RESET") return;
    action.mutate({ path: "/system/maintenance/reset-intelligence", body: { confirm: "RESET", reset_checkpoints: true }, label: "Reset all data" });
  };

  if (status.isLoading) return <Loading />;
  if (status.error) return <ErrorState message={(status.error as Error).message} />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">System Health</h1>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-fg">Status</h2>
        <ul className="space-y-1 text-sm">
          {Object.entries(status.data!.data).map(([k, v]) => (
            <li key={k} className="flex justify-between border-b border-line py-1">
              <span className="text-fg-muted">{k}</span>
              <span className="text-fg">{String(v)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-fg">Database</h2>
        {stats.data ? (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {Object.entries(stats.data.data).map(([t, n]) => (
              <div key={t} className="rounded bg-elevated px-2 py-1">
                <div className="text-xs text-fg-subtle">{t}</div>
                <div className="text-fg">{n}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">Loading counts…</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-fg">Maintenance</h2>
        <p className="mb-3 text-xs text-fg-subtle">Destructive actions are audited. Monitors, watchlists and settings are never touched by these.</p>
        {note && <div className="mb-3 rounded border border-line bg-elevated px-3 py-2 text-xs text-fg">{note}</div>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run("/system/maintenance/clear-runs", "Cleared runs", "Delete all ingestion run history?")}>Reset recent runs</Button>
          <Button onClick={() => run("/system/maintenance/clear-alerts", "Cleared alerts", "Delete all alerts?")}>Clear alerts</Button>
          <Button onClick={() => run("/system/maintenance/clear-usage", "Cleared usage", "Delete all usage/cost history?")}>Clear usage history</Button>
          <Button onClick={() => run("/system/maintenance/clear-digests", "Cleared digests", "Delete all digests?")}>Clear digests</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-fg-muted">
            Purge posts older than (days)
            <input
              type="number" min={1} max={3650} value={purgeDays}
              onChange={(e) => setPurgeDays(Number(e.target.value))}
              className="mt-1 block w-28 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
            />
          </label>
          <Button onClick={() => run("/system/maintenance/purge-old", `Purged posts older than ${purgeDays}d`, `Delete posts older than ${purgeDays} days? Starred posts are always kept.`, { days: purgeDays })}>
            Purge old posts
          </Button>
        </div>
        <div className="mt-5 border-t border-line pt-3">
          <Button variant="danger" onClick={resetAll}>Reset all data</Button>
          <p className="mt-1 text-xs text-fg-subtle">Wipes all collected intelligence and re-arms monitor checkpoints. Requires typing RESET.</p>
        </div>
      </Card>
    </div>
  );
}

/** Sources (spec §6.9). */
export function Sources() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.get<Envelope<{ username: string; name: string; posts: number; avg_relevance: number | null; last_seen: string }[]>>("/sources"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (data!.data.length === 0) return <EmptyState title="No sources ingested yet." />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Sources</h1>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-fg-subtle">
              <th className="py-1">Handle</th><th>Name</th><th>Posts</th><th>Avg relevance</th><th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data!.data.map((s) => (
              <tr key={s.username} className="border-t border-line">
                <td className="py-1 text-fg-muted">@{s.username}</td>
                <td className="text-fg-muted">{s.name}</td>
                <td>{s.posts}</td>
                <td>{s.avg_relevance != null ? Math.round(s.avg_relevance) : "—"}</td>
                <td className="text-fg-subtle">{timeAgo(s.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** Engagement history: daily goal attainment and per-session stats. */
export function Sessions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["engage-stats"],
    queryFn: () => api.get<Envelope<EngageStats>>("/engage/stats"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  const s = data!.data;
  const maxDay = Math.max(1, ...s.by_day.map((d) => d.replies));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Engagement</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Replies today" value={s.replies_today} hint={s.goal_met ? "goal met" : `goal ${s.daily_goal}`} />
        <Stat label="Daily goal" value={s.daily_goal} />
        <Stat label="Decisions recorded" value={s.learning.observations} hint="engaged + skipped" />
        <Stat label="Sessions logged" value={s.recent_sessions.length} />
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-fg">Replies per day</h2>
        {s.by_day.length === 0 ? (
          <p className="text-sm text-fg-subtle">No replies sent yet.</p>
        ) : (
          <div className="flex items-end gap-1" style={{ height: 100 }}>
            {s.by_day.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.replies}`}>
                <div className="w-full rounded-t bg-sky-600" style={{ height: `${(d.replies / maxDay) * 80}px` }} />
                <span className="mt-1 text-[10px] text-fg-subtle">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-fg">Recent sessions</h2>
        {s.recent_sessions.length === 0 ? (
          <p className="text-sm text-fg-subtle">No sessions yet. Start one on the Engage page.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-fg-subtle">
                <th className="py-1">Started</th><th>Goal</th><th>Reviewed</th>
                <th>Replies</th><th>Skipped</th><th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {s.recent_sessions.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="py-1 text-fg-muted">{timeAgo(x.startedAt)}</td>
                  <td>{x.goal}</td>
                  <td>{x.reviewed}</td>
                  <td className={x.repliesSent >= x.goal && x.goal > 0 ? "text-teal-400" : ""}>{x.repliesSent}</td>
                  <td className="text-fg-muted">{x.skipped}</td>
                  <td className="text-fg-subtle">
                    {x.endedAt ? `${Math.round(x.durationSeconds / 60)}m` : "in progress"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** Rules (spec §6.6). */
export function Rules() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["rules"],
    queryFn: () => api.get<Envelope<{ monitor_id: string; name: string; query: string; active: boolean }[]>>("/rules"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (data!.data.length === 0) return <EmptyState title="No rules defined." />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Rules</h1>
      {data!.data.map((r) => (
        <Card key={r.monitor_id}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-fg">{r.name}</span>
            <span className={`text-xs ${r.active ? "text-teal-300" : "text-fg-subtle"}`}>{r.active ? "active" : "inactive"}</span>
          </div>
          <code className="mt-1 block break-words text-xs text-fg-muted">{r.query}</code>
        </Card>
      ))}
    </div>
  );
}

