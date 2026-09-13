"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { Campaign, SearchRule, SubredditRef, VolumeReport } from "@/lib/types";

export function CampaignEditor({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [building, setBuilding] = useState(campaign.building);
  const [reaching, setReaching] = useState(campaign.reaching);
  const [filterDoc, setFilterDoc] = useState(campaign.filterDoc);
  const [strategyX, setStrategyX] = useState(campaign.strategyX);
  const [strategyReddit, setStrategyReddit] = useState(campaign.strategyReddit);
  const [rules, setRules] = useState<SearchRule[]>(campaign.searchRules);
  const [subs, setSubs] = useState<SubredditRef[]>(campaign.subreddits);
  const [subInput, setSubInput] = useState("");
  const [minFollowers, setMinFollowers] = useState(campaign.minFollowers);
  const [volumes, setVolumes] = useState<Record<string, VolumeReport>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkVolume(query: string) {
    const res = await fetch("/api/rules/volume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = (await res.json()) as VolumeReport;
    setVolumes((v) => ({ ...v, [query]: data }));
  }

  async function addSub() {
    const res = await fetch("/api/reddit/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: subInput }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setSubs((s) => [...s.filter((x) => x.name !== data.subreddit.name), data.subreddit]);
    setSubInput("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        building,
        reaching,
        filterDoc,
        strategyX,
        strategyReddit,
        searchRules: rules,
        subreddits: subs,
        minFollowers,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save");
      return;
    }
    toast("Campaign saved.");
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Delete this campaign? Past rounds stay in the log.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not delete");
      return;
    }
    toast("Campaign deleted.");
    router.push("/app/campaigns");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <h1 className="font-display text-4xl italic">Edit campaign</h1>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="building">What you are building</Label>
        <Textarea id="building" value={building} onChange={(e) => setBuilding(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reaching">Who you want to reach</Label>
        <Textarea id="reaching" value={reaching} onChange={(e) => setReaching(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="filter">AI filter</Label>
        <Textarea id="filter" value={filterDoc} onChange={(e) => setFilterDoc(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sx">X strategy</Label>
        <Textarea id="sx" value={strategyX} onChange={(e) => setStrategyX(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sr">Reddit strategy</Label>
        <Textarea id="sr" value={strategyReddit} onChange={(e) => setStrategyReddit(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rule">X search rules</Label>
        <Input
          id="rule"
          placeholder="Add a rule and press Enter"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const q = e.currentTarget.value.trim();
              if (q) {
                setRules((r) => [...r, { query: q, source: "manual" }]);
                void checkVolume(q);
              }
              e.currentTarget.value = "";
            }
          }}
        />
      </div>
      <ul className="text-sm text-muted">
        {rules.map((r) => (
          <li key={r.query} className="flex justify-between gap-2 py-1">
            <span>
              {r.query}
              {volumes[r.query] ? (
                <span className={volumes[r.query]!.retryable ? " text-pause" : " text-faint"}>
                  {" "}
                  — {volumes[r.query]!.message}
                </span>
              ) : null}
            </span>
            <button type="button" onClick={() => setRules((x) => x.filter((i) => i.query !== r.query))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Label htmlFor="minf">Min X followers (optional cutoff)</Label>
        <Input
          id="minf"
          type="number"
          min={0}
          value={minFollowers || ""}
          placeholder="0 — off"
          onChange={(e) => setMinFollowers(Math.max(0, Number(e.target.value) || 0))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sub">Subreddits</Label>
        <div className="flex gap-2">
          <Input id="sub" value={subInput} onChange={(e) => setSubInput(e.target.value)} placeholder="startups" />
          <Button variant="outline" type="button" onClick={addSub}>
            Add
          </Button>
        </div>
      </div>
      <ul className="text-sm text-muted">
        {subs.map((s) => (
          <li key={s.name} className="flex justify-between gap-2 py-1">
            r/{s.name}
            <button type="button" onClick={() => setSubs((x) => x.filter((i) => i.name !== s.name))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="paper" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => router.push("/app/campaigns")}>
          Back
        </Button>
        <Button variant="ghost" disabled={busy} onClick={remove}>
          Delete
        </Button>
      </div>
    </div>
  );
}
