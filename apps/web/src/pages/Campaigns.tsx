import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, Loading, ErrorState, EmptyState, Button } from "../components/ui";
import type { Campaign, Monitor, Network, VoiceProfile } from "../lib/types";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const NETWORKS: Network[] = ["x", "reddit"];

/** Campaigns: independent strategies, each with its own networks, monitors and voice. */
export function Campaigns() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["campaigns"] });

  const list = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<Envelope<Campaign[]>>("/campaigns"),
  });

  const create = useMutation({
    mutationFn: (n: string) => api.post("/campaigns", { name: n, slug: slugify(n) }),
    onSuccess: () => { setName(""); invalidate(); },
  });

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorState message={(list.error as Error).message} />;
  const campaigns = list.data!.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-fg">Campaigns</h1>
        <p className="text-sm text-fg-subtle">
          Independent strategies. Each has its own networks, monitors, voice, and daily reply goal.
        </p>
      </header>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-fg-muted">
          New campaign
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate(name.trim())}
            placeholder="e.g. ctDNA / MRD"
            className="mt-1 block w-64 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
          />
        </label>
        <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate(name.trim())}>
          Create
        </Button>
        {name.trim() && <span className="text-xs text-fg-subtle">slug: {slugify(name)}</span>}
      </Card>

      {campaigns.length === 0 && (
        <EmptyState title="No campaigns yet." hint="Create one above, then attach monitors to it." />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          {campaigns.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={`block w-full rounded border p-3 text-left ${selected === c.id ? "border-sky-600 bg-sky-600/10" : "border-line bg-panel/60 hover:bg-elevated"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-fg">{c.name}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${c.enabled ? "bg-teal-500/20 text-teal-300" : "bg-elevated text-fg-muted"}`}>
                  {c.enabled ? "enabled" : "paused"}
                </span>
              </div>
              <div className="mt-1 text-xs text-fg-subtle">
                {c.networks.join(" + ")} · {c.monitorCount ?? 0} monitors · goal {c.goalRepliesPerDay}/day
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <CampaignDetail campaignId={selected} onChanged={invalidate} onDeleted={() => { setSelected(null); invalidate(); }} />
          ) : (
            <EmptyState title="Select a campaign to configure it." />
          )}
        </div>
      </div>

      <VoiceProfiles />
    </div>
  );
}

function CampaignDetail({
  campaignId, onChanged, onDeleted,
}: {
  campaignId: string; onChanged: () => void; onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const key = ["campaign", campaignId];
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); onChanged(); };

  const detail = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<Envelope<{
        campaign: Campaign; monitors: Monitor[]; available_monitors: Monitor[]; voice: VoiceProfile | null;
      }>>(`/campaigns/${campaignId}`),
  });

  const voices = useQuery({
    queryKey: ["voice-profiles"],
    queryFn: () => api.get<Envelope<VoiceProfile[]>>("/voice-profiles"),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/campaigns/${campaignId}`, body),
    onSuccess: refresh,
  });
  const link = useMutation({
    mutationFn: (monitorId: string) => api.post(`/campaigns/${campaignId}/monitors`, { monitor_id: monitorId }),
    onSuccess: refresh,
  });
  const unlink = useMutation({
    mutationFn: (monitorId: string) => api.del(`/campaigns/${campaignId}/monitors/${monitorId}`),
    onSuccess: refresh,
  });
  const detach = useMutation({
    mutationFn: (network: Network) => api.post(`/campaigns/${campaignId}/detach-network`, { network }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/campaigns/${campaignId}`),
    onSuccess: onDeleted,
  });

  if (detail.isLoading) return <Loading />;
  if (detail.error) return <ErrorState message={(detail.error as Error).message} />;
  const { campaign, monitors, available_monitors } = detail.data!.data;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-fg">{campaign.name}</h2>
          <p className="text-xs text-fg-subtle">{campaign.slug}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => patch.mutate({ enabled: !campaign.enabled })}>
            {campaign.enabled ? "Pause" : "Enable"}
          </Button>
          <Button
            variant="danger"
            onClick={() => window.confirm("Delete this campaign? Monitors themselves are kept.") && remove.mutate()}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-line pb-3">
        <label className="text-xs text-fg-muted">
          Daily reply goal
          <input
            type="number" min={0} max={200} defaultValue={campaign.goalRepliesPerDay}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== campaign.goalRepliesPerDay) patch.mutate({ goal_replies_per_day: v });
            }}
            className="mt-1 block w-24 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
          />
        </label>
        <label className="text-xs text-fg-muted">
          Voice profile
          <select
            value={campaign.voiceProfileId ?? ""}
            onChange={(e) => patch.mutate({ voice_profile_id: e.target.value || null })}
            className="mt-1 block w-48 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
          >
            <option value="">Default voice</option>
            {(voices.data?.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <div className="text-xs text-fg-muted">
          Networks
          <div className="mt-1 flex gap-2">
            {NETWORKS.map((n) => {
              const on = campaign.networks.includes(n);
              return (
                <button
                  key={n}
                  onClick={() =>
                    on
                      ? detach.mutate(n)
                      : patch.mutate({ networks: [...campaign.networks, n] })
                  }
                  title={on ? `Detach ${n} (unlinks its monitors, keeps the campaign)` : `Add ${n}`}
                  className={`rounded px-2 py-1 text-xs ${on ? "bg-sky-600/20 text-sky-300" : "bg-elevated text-fg-muted"}`}
                >
                  {n === "x" ? "X" : "Reddit"} {on ? "✓" : "+"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <label className="block text-xs text-fg-muted">
        Strategy (given to the drafting model as campaign context)
        <textarea
          defaultValue={campaign.strategy ?? ""}
          onBlur={(e) => e.target.value !== (campaign.strategy ?? "") && patch.mutate({ strategy: e.target.value || null })}
          rows={2}
          placeholder="e.g. Be genuinely useful to ctDNA/MRD researchers. Never pitch."
          className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
        />
      </label>

      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-xs uppercase tracking-wide text-fg-subtle">Monitors in this campaign</h3>
        {monitors.length === 0 ? (
          <p className="mt-1 text-sm text-fg-subtle">None yet — attach one below.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {monitors.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-fg">{m.name}</span>
                <button onClick={() => unlink.mutate(m.id)} className="shrink-0 text-xs text-red-400 hover:underline">
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {available_monitors.length > 0 && (
          <label className="mt-3 block text-xs text-fg-muted">
            Attach a monitor
            <select
              value=""
              onChange={(e) => e.target.value && link.mutate(e.target.value)}
              className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
            >
              <option value="">Select…</option>
              {available_monitors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </Card>
  );
}

function VoiceProfiles() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["voice-profiles"] });

  const list = useQuery({
    queryKey: ["voice-profiles"],
    queryFn: () => api.get<Envelope<VoiceProfile[]>>("/voice-profiles"),
  });
  const create = useMutation({
    mutationFn: (n: string) => api.post("/voice-profiles", { name: n }),
    onSuccess: () => { setName(""); refresh(); },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/voice-profiles/${id}`, body),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/voice-profiles/${id}`),
    onSuccess: refresh,
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-fg">Voice profiles</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        The one-time setup that reply drafting is conditioned on. Lists are comma-separated.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate(name.trim())}
          placeholder="Profile name"
          className="block w-56 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
        />
        <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate(name.trim())}>
          Add profile
        </Button>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : (list.data?.data ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-fg-subtle">No profiles yet — drafts use a sensible default voice.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {(list.data?.data ?? []).map((v) => (
            <div key={v.id} className="rounded border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-fg">{v.name}</span>
                <button onClick={() => remove.mutate(v.id)} className="text-xs text-red-400 hover:underline">
                  delete
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Tone" value={v.tone} onSave={(x) => patch.mutate({ id: v.id, body: { tone: x } })} />
                <Field label="Audience" value={v.audience ?? ""} onSave={(x) => patch.mutate({ id: v.id, body: { audience: x || null } })} />
                <Field label="Perspective" value={v.perspective ?? ""} onSave={(x) => patch.mutate({ id: v.id, body: { perspective: x || null } })} />
                <Field
                  label="Max characters" value={String(v.maxChars)}
                  onSave={(x) => Number(x) > 0 && patch.mutate({ id: v.id, body: { max_chars: Number(x) } })}
                />
                <Field
                  label="Always (comma-separated)" value={v.do.join(", ")}
                  onSave={(x) => patch.mutate({ id: v.id, body: { do: splitList(x) } })}
                />
                <Field
                  label="Never (comma-separated)" value={v.dont.join(", ")}
                  onSave={(x) => patch.mutate({ id: v.id, body: { dont: splitList(x) } })}
                />
              </div>
              <Field
                label="Style anchors (one per line)" value={v.sampleReplies.join("\n")} multiline
                onSave={(x) => patch.mutate({ id: v.id, body: { sample_replies: x.split("\n").map((s) => s.trim()).filter(Boolean) } })}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Field({
  label, value, onSave, multiline,
}: {
  label: string; value: string; onSave: (v: string) => void; multiline?: boolean;
}) {
  const cls = "mt-1 block w-full rounded border border-line bg-bg px-2 py-1 text-sm text-fg";
  return (
    <label className="block text-xs text-fg-muted">
      {label}
      {multiline ? (
        <textarea defaultValue={value} rows={3} onBlur={(e) => e.target.value !== value && onSave(e.target.value)} className={cls} />
      ) : (
        <input defaultValue={value} onBlur={(e) => e.target.value !== value && onSave(e.target.value)} className={cls} />
      )}
    </label>
  );
}

function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
