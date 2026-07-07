import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import { timeAgo } from "../lib/format";
import type { Monitor } from "../lib/types";

export function Monitors() {
  const qc = useQueryClient();
  const [runNote, setRunNote] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api.get<Envelope<Monitor[]>>("/monitors"),
  });

  const toggle = useMutation({
    mutationFn: (m: Monitor) => api.patch(`/monitors/${m.id}`, { enabled: !m.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monitors"] }),
  });
  const run = useMutation({
    mutationFn: (m: Monitor) => api.post<Envelope<{ enqueued: boolean; max_results: number }>>(`/monitors/${m.id}/run`),
    onSuccess: (r) => setRunNote(`Run enqueued (up to ${r.data.max_results} results). Budget still enforced server-side.`),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-fg">Monitors</h1>
        <p className="text-sm text-fg-subtle">Collection is disabled by default to avoid unexpected X API cost.</p>
      </header>
      {runNote && <div className="rounded border border-amber-800/50 bg-amber-950/30 p-3 text-sm text-amber-300">{runNote}</div>}
      {data!.data.length === 0 && <EmptyState title="No monitors are configured." />}
      <div className="space-y-3">
        {data!.data.map((m) => (
          <Card key={m.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">{m.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${m.enabled ? "bg-teal-500/20 text-teal-300" : "bg-elevated text-fg-muted"}`}>
                    {m.enabled ? "enabled" : "disabled"}
                  </span>
                  <span className="text-xs text-fg-subtle">{m.type}</span>
                </div>
                {m.xQuery && <code className="mt-1 block truncate text-xs text-fg-muted">{m.xQuery}</code>}
                <div className="mt-1 text-xs text-fg-subtle">
                  every {m.pollIntervalMinutes}m · max {m.maxResultsPerRun}/run · prefilter ≥ {m.prefilterThreshold} · last success {timeAgo(m.lastSuccessAt)}
                </div>
                {m.lastError && <div className="mt-1 text-xs text-red-400">last error: {m.lastError}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button onClick={() => toggle.mutate(m)}>{m.enabled ? "Disable" : "Enable"}</Button>
                <Button variant="primary" onClick={() => run.mutate(m)}>Run now</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
