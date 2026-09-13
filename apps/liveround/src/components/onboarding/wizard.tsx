"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { SearchRule, SocialPost, SubredditRef } from "@/lib/types";

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [building, setBuilding] = useState("");
  const [reaching, setReaching] = useState("");
  const [site, setSite] = useState("");
  const [filterDoc, setFilterDoc] = useState("");
  const [strategyX, setStrategyX] = useState("");
  const [strategyReddit, setStrategyReddit] = useState("");
  const [rules, setRules] = useState<SearchRule[]>([]);
  const [subs, setSubs] = useState<SubredditRef[]>([]);
  const [subInput, setSubInput] = useState("");
  const [preview, setPreview] = useState<SocialPost[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function think() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ building, reaching, site, think: true, previewNetworks: ["x", "reddit"] }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setFilterDoc(data.campaign.filterDoc);
    setStrategyX(data.campaign.strategyX);
    setStrategyReddit(data.campaign.strategyReddit);
    setRules(data.campaign.searchRules);
    setSubs(data.campaign.subreddits);
    setPreview(data.preview ?? []);
    setStep(2);
  }

  async function saveAndPreview() {
    setBusy(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        building,
        reaching,
        filterDoc,
        strategyX,
        strategyReddit,
        searchRules: rules,
        subreddits: subs,
        previewNetworks: ["x", "reddit"],
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setPreview(data.preview ?? []);
    setStep(3);
  }

  async function finish() {
    await fetch("/api/onboarding/complete", { method: "POST" });
    router.push("/app/session");
    router.refresh();
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-xs uppercase tracking-[0.18em] text-faint">Setup {step + 1} / 4</p>
      {step === 0 ? (
        <div className="mt-6 space-y-4">
          <h1 className="font-display text-4xl italic">What are you building?</h1>
          <Textarea value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="A cockpit for founders who reply in public." />
          <Button variant="paper" disabled={!building.trim()} onClick={() => setStep(1)}>
            Continue
          </Button>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="mt-6 space-y-4">
          <h1 className="font-display text-4xl italic">Who do you want to reach?</h1>
          <Textarea value={reaching} onChange={(e) => setReaching(e.target.value)} placeholder="Founders who already hang out in live product threads." />
          <Label htmlFor="site">Site or name (optional)</Label>
          <Input id="site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="yoursite.com" />
          <div className="flex flex-wrap gap-2">
            <Button variant="paper" disabled={!reaching.trim() || busy} onClick={think}>
              Think for me
            </Button>
            <Button variant="outline" disabled={!reaching.trim()} onClick={() => setStep(2)}>
              I’ll write it
            </Button>
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="mt-6 space-y-5">
          <h1 className="font-display text-4xl italic">Filter and rules</h1>
          <Label>AI filter</Label>
          <Textarea value={filterDoc} onChange={(e) => setFilterDoc(e.target.value)} />
          <Label>X strategy</Label>
          <Textarea value={strategyX} onChange={(e) => setStrategyX(e.target.value)} />
          <Label>Reddit strategy</Label>
          <Textarea value={strategyReddit} onChange={(e) => setStrategyReddit(e.target.value)} />
          <Label>X search rules</Label>
          <Input
            placeholder="Add a rule and press Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const q = e.currentTarget.value.trim();
                if (q) setRules((r) => [...r, { query: q, source: "manual" }]);
                e.currentTarget.value = "";
              }
            }}
          />
          <ul className="text-sm text-muted">
            {rules.map((r) => (
              <li key={r.query} className="flex justify-between gap-2 py-1">
                {r.query}
                <button type="button" onClick={() => setRules((x) => x.filter((i) => i.query !== r.query))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <Label>Subreddits</Label>
          <div className="flex gap-2">
            <Input value={subInput} onChange={(e) => setSubInput(e.target.value)} placeholder="startups" />
            <Button variant="outline" type="button" onClick={addSub}>
              Add
            </Button>
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
          <Button variant="paper" disabled={busy} onClick={saveAndPreview}>
            Preview matching posts
          </Button>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="mt-6 space-y-5">
          <h1 className="font-display text-4xl italic">A real match, before you commit.</h1>
          {preview.length === 0 ? (
            <p className="text-muted">Nothing matched yet. Add a rule or subreddit and go back one step.</p>
          ) : (
            <article className="rounded-lg bg-paper p-6 text-paper-ink">
              <p className="text-xs uppercase tracking-widest text-paper-muted">
                @{preview[0]?.authorHandle} · {preview[0]?.network}
              </p>
              <p className="mt-3 whitespace-pre-wrap font-display text-xl">{preview[0]?.body}</p>
            </article>
          )}
          {preview.slice(1).length ? (
            <p className="text-sm text-faint">{preview.length - 1} more stacked behind this one.</p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              Edit docs
            </Button>
            <Button variant="paper" onClick={finish} disabled={preview.length === 0}>
              Finish setup
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
