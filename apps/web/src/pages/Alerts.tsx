import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import { timeAgo } from "../lib/format";
import type { Alert } from "../lib/types";

const SEVERITIES: Alert["severity"][] = ["info", "medium", "high", "critical"];

const SEV: Record<Alert["severity"], string> = {
  info: "bg-elevated text-fg-muted",
  medium: "bg-teal-500/20 text-teal-300",
  high: "bg-amber-500/20 text-amber-300",
  critical: "bg-red-600/20 text-red-300",
};

export function Alerts() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<Envelope<Alert[]>>("/alerts") });
  const patch = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/alerts/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<Alert["severity"]>("medium");
  const create = useMutation({
    mutationFn: () => api.post("/alerts", { title, reason, severity }),
    onSuccess: () => { setTitle(""); setReason(""); setSeverity("medium"); qc.invalidateQueries({ queryKey: ["alerts"] }); },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Alerts</h1>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-fg">New alert</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-fg-muted">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary"
              className="mt-1 block w-64 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
            />
          </label>
          <label className="text-xs text-fg-muted">
            Severity
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Alert["severity"])}
              className="mt-1 block rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="w-full text-xs text-fg-muted sm:w-auto sm:flex-1">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this matters"
              className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
            />
          </label>
          <Button variant="primary" disabled={!title.trim() || !reason.trim() || create.isPending} onClick={() => create.mutate()}>
            Create alert
          </Button>
        </div>
      </Card>

      {data!.data.length === 0 && <EmptyState title="No high-priority signals in this period." />}
      <div className="space-y-3">
        {data!.data.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${SEV[a.severity]}`}>{a.severity}</span>
                  <span className="font-medium text-fg">{a.title}</span>
                  <span className="text-xs text-fg-subtle">{a.status}</span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{a.reason}</p>
                <p className="mt-1 text-xs text-fg-subtle">{timeAgo(a.createdAt)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button onClick={() => patch.mutate({ id: a.id, status: "acknowledged" })}>Ack</Button>
                <Button onClick={() => patch.mutate({ id: a.id, status: "resolved" })}>Resolve</Button>
                <Button onClick={() => patch.mutate({ id: a.id, status: "dismissed" })}>Dismiss</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
