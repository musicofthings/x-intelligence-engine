import { useQuery } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Stat, Loading, ErrorState } from "../components/ui";
import { timeAgo } from "../lib/format";

interface Summary {
  active_monitors: number;
  total_monitors: number;
  open_alerts: number;
  x_resources_today: number;
  x_resources_month: number;
  claude_requests_today: number;
  last_successful_collection: string | null;
  failed_jobs: number;
  recent_runs: { id: string; status: string; startedAt: string; postsNew: number }[];
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Envelope<Summary>>("/dashboard/summary"),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  const s = data!.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-500">Operational overview of collection, screening, and signals.</p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Active monitors" value={`${s.active_monitors}/${s.total_monitors}`} />
        <Stat label="Open alerts" value={s.open_alerts} />
        <Stat label="X reads today" value={s.x_resources_today} hint={`${s.x_resources_month} this month`} />
        <Stat label="Claude calls today" value={s.claude_requests_today} />
        <Stat label="Failed jobs" value={s.failed_jobs} />
        <Stat label="Last collection" value={timeAgo(s.last_successful_collection)} />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Recent ingestion runs</h2>
        {s.recent_runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet. Enable a monitor to begin collection.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1">Status</th>
                <th>New posts</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {s.recent_runs.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="py-1">{r.status}</td>
                  <td>{r.postsNew}</td>
                  <td className="text-slate-400">{timeAgo(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
