import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Page } from "../lib/api";
import { Card, ScoreBadge, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import { timeAgo } from "../lib/format";
import type { FeedPost } from "../lib/types";

export function Feed() {
  const [search, setSearch] = useState("");
  const [minStrategic, setMinStrategic] = useState<number | "">("");
  const [debounced, setDebounced] = useState("");

  const params = new URLSearchParams();
  if (debounced) params.set("search", debounced);
  if (minStrategic !== "") params.set("min_strategic", String(minStrategic));
  params.set("limit", "25");

  const { data, isLoading, error } = useQuery({
    queryKey: ["feed", debounced, minStrategic],
    queryFn: () => api.get<Page<FeedPost>>(`/posts?${params.toString()}`),
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Intelligence Feed</h1>
          <p className="text-sm text-slate-500">Screened X signals. Content is untrusted external data.</p>
        </div>
      </header>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setDebounced(search)}
            placeholder="text or author…"
            className="mt-1 block w-64 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Min strategic
          <input
            type="number" min={0} max={100}
            value={minStrategic}
            onChange={(e) => setMinStrategic(e.target.value === "" ? "" : Number(e.target.value))}
            className="mt-1 block w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <Button variant="primary" onClick={() => setDebounced(search)}>Apply</Button>
      </Card>

      {isLoading && <Loading />}
      {error && <ErrorState message={(error as Error).message} />}
      {data && data.data.length === 0 && (
        <EmptyState title="No intelligence posts match these filters." hint="Adjust filters or enable a monitor." />
      )}

      <div className="space-y-3">
        {data?.data.map((item) => (
          <Card key={item.post.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-slate-100">{item.post.authorName ?? "Unknown"}</span>
                  <span className="text-slate-500">@{item.post.authorUsername ?? "unknown"}</span>
                  <span className="text-slate-600">· {timeAgo(item.post.createdAt)}</span>
                </div>
                {/* X content rendered as plain text — never as HTML (spec §6.2). */}
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-300">{item.post.text}</p>
                {item.screening && (
                  <p className="mt-2 text-xs text-slate-400">
                    <span className="text-slate-500">AI:</span> {item.screening.summary}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <ScoreBadge label="rel" score={item.screening?.relevanceScore} />
                <ScoreBadge label="str" score={item.screening?.strategicImportanceScore} />
                <ScoreBadge label="cred" score={item.screening?.credibilityScore} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs">
              <Link to={`/posts/${item.post.id}`} className="text-sky-400 hover:underline">Details</Link>
              {item.post.url && (
                <a href={item.post.url} target="_blank" rel="noreferrer noopener" className="text-slate-500 hover:text-slate-300">
                  Original ↗
                </a>
              )}
              {item.screening?.topic && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">{item.screening.topic}</span>}
            </div>
          </Card>
        ))}
      </div>
      {data?.page.has_more && <p className="text-center text-xs text-slate-500">More results available — refine filters to narrow.</p>}
    </div>
  );
}
