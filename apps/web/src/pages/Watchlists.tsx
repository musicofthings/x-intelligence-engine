import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import type { Watchlist, WatchlistAccount } from "../lib/types";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function Watchlists() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["watchlists"] });

  const list = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => api.get<Envelope<Watchlist[]>>("/watchlists"),
  });

  const create = useMutation({
    mutationFn: (n: string) => api.post("/watchlists", { name: n, slug: slugify(n) }),
    onSuccess: () => { setName(""); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/watchlists/${id}`),
    onSuccess: () => { setSelected(null); invalidate(); },
  });
  const toggle = useMutation({
    mutationFn: (w: Watchlist) => api.patch(`/watchlists/${w.id}`, { enabled: !w.enabled }),
    onSuccess: invalidate,
  });

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorState message={(list.error as Error).message} />;
  const watchlists = list.data!.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-fg">Watchlists</h1>
        <p className="text-sm text-fg-subtle">Curated account groups (AI Labs, Genomics Companies, Oncology KOLs…).</p>
      </header>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-fg-muted">
          New watchlist
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate(name.trim())}
            placeholder="e.g. Oncology KOLs"
            className="mt-1 block w-64 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
          />
        </label>
        <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate(name.trim())}>
          Create
        </Button>
        {name.trim() && <span className="text-xs text-fg-subtle">slug: {slugify(name)}</span>}
      </Card>

      {watchlists.length === 0 && <EmptyState title="No watchlists yet." hint="Create one above to group accounts." />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          {watchlists.map((w) => (
            <button
              key={w.id}
              onClick={() => setSelected(w.id)}
              className={`block w-full rounded border p-3 text-left ${selected === w.id ? "border-sky-600 bg-sky-600/10" : "border-line bg-panel/60 hover:bg-elevated"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-fg">{w.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${w.enabled ? "bg-teal-500/20 text-teal-300" : "bg-elevated text-fg-muted"}`}>
                  {w.enabled ? "enabled" : "disabled"}
                </span>
              </div>
              <div className="mt-1 text-xs text-fg-subtle">{w.accountCount ?? 0} accounts</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <WatchlistDetail
              watchlist={watchlists.find((w) => w.id === selected)!}
              onToggle={() => toggle.mutate(watchlists.find((w) => w.id === selected)!)}
              onDelete={() => {
                if (window.confirm("Delete this watchlist and its accounts?")) remove.mutate(selected);
              }}
              onAccountsChanged={invalidate}
            />
          ) : (
            <EmptyState title="Select a watchlist to manage its accounts." />
          )}
        </div>
      </div>
    </div>
  );
}

function WatchlistDetail({
  watchlist, onToggle, onDelete, onAccountsChanged,
}: {
  watchlist: Watchlist; onToggle: () => void; onDelete: () => void; onAccountsChanged: () => void;
}) {
  const qc = useQueryClient();
  const [handle, setHandle] = useState("");
  const [priority, setPriority] = useState(50);

  const accounts = useQuery({
    queryKey: ["watchlist", watchlist.id],
    queryFn: () => api.get<Envelope<{ watchlist: Watchlist; accounts: WatchlistAccount[] }>>(`/watchlists/${watchlist.id}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["watchlist", watchlist.id] });
    onAccountsChanged();
  };
  const addAccount = useMutation({
    mutationFn: () => api.post(`/watchlists/${watchlist.id}/accounts`, { username: handle.replace(/^@/, ""), priority }),
    onSuccess: () => { setHandle(""); refresh(); },
  });
  const removeAccount = useMutation({
    mutationFn: (accountId: string) => api.del(`/watchlists/${watchlist.id}/accounts/${accountId}`),
    onSuccess: refresh,
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-fg">{watchlist.name}</h2>
          {watchlist.description && <p className="text-xs text-fg-subtle">{watchlist.description}</p>}
        </div>
        <div className="flex gap-2">
          <Button onClick={onToggle}>{watchlist.enabled ? "Disable" : "Enable"}</Button>
          <Button variant="danger" onClick={onDelete}>Delete</Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 border-b border-line pb-3">
        <label className="text-xs text-fg-muted">
          Add account (@handle)
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handle.trim() && addAccount.mutate()}
            placeholder="@handle"
            className="mt-1 block w-48 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
          />
        </label>
        <label className="text-xs text-fg-muted">
          Priority
          <input
            type="number" min={0} max={100} value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="mt-1 block w-20 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
          />
        </label>
        <Button variant="primary" disabled={!handle.trim() || addAccount.isPending} onClick={() => addAccount.mutate()}>
          Add
        </Button>
      </div>

      {accounts.isLoading ? (
        <Loading />
      ) : accounts.data && accounts.data.data.accounts.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-fg-subtle">
              <th className="py-1">Handle</th><th>Priority</th><th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.data.accounts.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="py-1 text-fg">@{a.username}</td>
                <td className="text-fg-muted">{a.priority}</td>
                <td className="text-right">
                  <button onClick={() => removeAccount.mutate(a.id)} className="text-xs text-red-400 hover:underline">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-fg-subtle">No accounts yet. Add handles above.</p>
      )}
    </Card>
  );
}
