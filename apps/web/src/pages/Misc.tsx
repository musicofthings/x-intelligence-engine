import { useQuery } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Stat, Loading, ErrorState, EmptyState } from "../components/ui";
import { timeAgo } from "../lib/format";

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
      <h1 className="text-xl font-semibold text-slate-100">Usage &amp; Cost</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="X reads today" value={u.x_resources_day} />
        <Stat label="X reads 30d" value={u.x_resources_month} />
        <Stat label="Est. X cost today" value={`$${u.estimated_x_cost_day_usd.toFixed(2)}`} />
        <Stat label="Claude calls today" value={u.claude_requests_day} />
      </div>
      <p className="text-xs text-slate-500">{u.note}</p>
    </div>
  );
}

/** Settings (spec §6.11) — capability flags only, never secret values. */
export function Settings() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Envelope<{ settings: Record<string, unknown>; capabilities: Record<string, unknown> }>>("/settings"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  const { settings, capabilities } = data!.data;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Capabilities</h2>
        <ul className="space-y-1 text-sm">
          {Object.entries(capabilities).map(([k, v]) => (
            <li key={k} className="flex justify-between border-b border-slate-800 py-1">
              <span className="text-slate-400">{k}</span>
              <span className="text-slate-200">{String(v)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Secret values (X bearer, Anthropic key, MCP token) are never sent to the browser.</p>
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Configuration</h2>
        <pre className="text-xs text-slate-400">{JSON.stringify(settings, null, 2)}</pre>
      </Card>
    </div>
  );
}

/** System health (spec §6.12). */
export function System() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["system"],
    queryFn: () => api.get<Envelope<Record<string, unknown>>>("/system/status"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">System Health</h1>
      <Card>
        <ul className="space-y-1 text-sm">
          {Object.entries(data!.data).map(([k, v]) => (
            <li key={k} className="flex justify-between border-b border-slate-800 py-1">
              <span className="text-slate-400">{k}</span>
              <span className="text-slate-200">{String(v)}</span>
            </li>
          ))}
        </ul>
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
      <h1 className="text-xl font-semibold text-slate-100">Sources</h1>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1">Handle</th><th>Name</th><th>Posts</th><th>Avg relevance</th><th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data!.data.map((s) => (
              <tr key={s.username} className="border-t border-slate-800">
                <td className="py-1 text-slate-300">@{s.username}</td>
                <td className="text-slate-400">{s.name}</td>
                <td>{s.posts}</td>
                <td>{s.avg_relevance != null ? Math.round(s.avg_relevance) : "—"}</td>
                <td className="text-slate-500">{timeAgo(s.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <h1 className="text-xl font-semibold text-slate-100">Rules</h1>
      {data!.data.map((r) => (
        <Card key={r.monitor_id}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-200">{r.name}</span>
            <span className={`text-xs ${r.active ? "text-teal-300" : "text-slate-500"}`}>{r.active ? "active" : "inactive"}</span>
          </div>
          <code className="mt-1 block break-words text-xs text-slate-400">{r.query}</code>
        </Card>
      ))}
    </div>
  );
}

/** Watchlists (spec §6.5) — placeholder list; CRUD via API when configured. */
export function Watchlists() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Watchlists</h1>
      <EmptyState
        title="No watchlists configured."
        hint="Create curated account groups (AI Labs, Genomics Companies, Oncology KOLs). Handles resolve to IDs via the official X API."
      />
    </div>
  );
}
