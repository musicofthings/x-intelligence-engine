import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import type { Digest } from "../lib/types";

export function Digests() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["digests"], queryFn: () => api.get<Envelope<Digest[]>>("/digests") });
  const detail = useQuery({
    queryKey: ["digest", selected],
    queryFn: () => api.get<Envelope<Digest>>(`/digests/${selected}`),
    enabled: !!selected,
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Digests</h1>
      {data!.data.length === 0 && <EmptyState title="No digests generated yet." hint="Digests are produced daily at 08:00 Asia/Kolkata." />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          {data!.data.map((d) => (
            <button key={d.id} onClick={() => setSelected(d.id)}
              className={`block w-full rounded border p-3 text-left text-sm ${selected === d.id ? "border-sky-600 bg-sky-600/10" : "border-line bg-panel/60 hover:bg-elevated"}`}>
              <div className="font-medium text-fg">{d.title}</div>
              <div className="text-xs text-fg-subtle">{d.periodStart.slice(0, 10)} → {d.periodEnd.slice(0, 10)}</div>
            </button>
          ))}
        </div>
        <div className="lg:col-span-2">
          {selected && detail.data && (
            <Card>
              <div className="mb-2 flex justify-end">
                <Button onClick={() => navigator.clipboard?.writeText(detail.data!.data.contentMarkdown ?? "")}>Copy Markdown</Button>
              </div>
              <pre className="whitespace-pre-wrap break-words text-sm text-fg-muted">{detail.data.data.contentMarkdown}</pre>
            </Card>
          )}
          {!selected && <EmptyState title="Select a digest to view." />}
        </div>
      </div>
    </div>
  );
}
