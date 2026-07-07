import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import { timeAgo } from "../lib/format";
import type { Alert } from "../lib/types";

const SEV: Record<Alert["severity"], string> = {
  info: "bg-slate-700 text-slate-300",
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

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Alerts</h1>
      {data!.data.length === 0 && <EmptyState title="No high-priority signals in this period." />}
      <div className="space-y-3">
        {data!.data.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${SEV[a.severity]}`}>{a.severity}</span>
                  <span className="font-medium text-slate-100">{a.title}</span>
                  <span className="text-xs text-slate-500">{a.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-400">{a.reason}</p>
                <p className="mt-1 text-xs text-slate-600">{timeAgo(a.createdAt)}</p>
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
