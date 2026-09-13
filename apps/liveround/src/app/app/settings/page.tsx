"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { PlanCatalog, PackCatalog } from "@/lib/billing/catalog";
import type { PostingSettings, SocialAccount, UserRecord, WritingSettings } from "@/lib/types";

export default function SettingsPage() {
  const [bio, setBio] = useState("");
  const [notes, setNotes] = useState("");
  const [length, setLength] = useState(50);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [xConfigured, setX] = useState(false);
  const [redditConfigured, setR] = useState(false);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [posting, setPosting] = useState<PostingSettings | null>(null);
  const [plans, setPlans] = useState<PlanCatalog[]>([]);
  const [packs, setPacks] = useState<PackCatalog[]>([]);
  const [stripeOn, setStripeOn] = useState(false);
  const [oauthMsg, setOauthMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const oauth = new URLSearchParams(window.location.search).get("oauth");
    if (oauth === "ok") setOauthMsg("X connected.");
    if (oauth === "denied") setOauthMsg("X connection was cancelled.");
    if (oauth === "failed" || oauth === "expired") setOauthMsg("X connection failed. Try again.");
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { writing?: WritingSettings; accounts?: SocialAccount[]; user?: UserRecord }) => {
        if (d.writing) {
          setBio(d.writing.bio);
          setNotes(d.writing.writingNotes);
          setLength(d.writing.replyLength);
        }
        setAccounts(d.accounts ?? []);
        setUser(d.user ?? null);
      });
    void fetch("/api/session")
      .then((r) => r.json())
      .then((d: { xConfigured?: boolean; redditConfigured?: boolean }) => {
        setX(Boolean(d.xConfigured));
        setR(Boolean(d.redditConfigured));
      });
    void fetch("/api/ideas")
      .then((r) => r.json())
      .then((d: { posting?: PostingSettings }) => {
        if (d.posting) setPosting(d.posting);
      });
    void fetch("/api/billing/checkout")
      .then((r) => r.json())
      .then((d: { configured?: boolean; plans?: PlanCatalog[]; packs?: PackCatalog[]; user?: UserRecord }) => {
        setStripeOn(Boolean(d.configured));
        setPlans(d.plans ?? []);
        setPacks(d.packs ?? []);
        if (d.user) setUser(d.user);
      });
  }, []);

  async function save() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio, writingNotes: notes, replyLength: length }),
    });
    if (!res.ok) {
      toast.error("Could not save writing notes.");
      return;
    }
    toast("Writing notes saved.");
  }

  async function savePosting() {
    if (!posting) return;
    const res = await fetch("/api/ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ posting }),
    });
    if (!res.ok) {
      toast.error("Could not save posting window.");
      return;
    }
    toast("Posting window saved.");
  }

  async function checkout(sku: string) {
    setBusy(sku);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku }),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    setBusy(null);
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    setOauthMsg(data.error ?? "Checkout unavailable");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-12 px-4 py-10">
      <section className="space-y-4">
        <h1 className="font-display text-4xl italic">Writing</h1>
        {!xConfigured ? (
          <div className="rounded-md border border-pause/40 bg-chrome-2 p-4 text-sm text-pause">
            X API keys are missing. Discovery uses the mock adapter. This is not production X. Connect keys
            via X_CLIENT_ID and X_CLIENT_SECRET when you have them.
          </div>
        ) : null}
        {oauthMsg ? <p className="text-sm text-muted">{oauthMsg}</p> : null}
        <div className="space-y-2">
          <Label htmlFor="bio">Profile bio</Label>
          <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">AI writing notes</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="len">Reply length — short to long</Label>
          <input
            id="len"
            type="range"
            min={0}
            max={100}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="mt-3 w-full"
          />
          <p className="mt-1 text-xs text-faint">Default mid. Punchier on X, meatier on Reddit.</p>
        </div>
        <Button variant="paper" onClick={save}>
          Save
        </Button>
      </section>

      <section>
        <h2 className="font-display text-2xl italic">Accounts</h2>
        <p className="mt-2 text-sm text-muted">
          {`OAuth only — we never ask for an X or Reddit password. Reddit app-only search: ${redditConfigured ? "yes" : "no"}.`}
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {accounts.map((a) => (
            <li key={a.id} className="rounded-md border border-line px-4 py-3">
              {a.displayName} · {a.provider} · {a.status}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {xConfigured ? (
            <Button asChild variant="paper" size="sm">
              <a href="/api/oauth/x/start">Connect X</a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Connect X — keys missing
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl italic">Posting</h2>
        <p className="mt-2 text-sm text-muted">
          Approved Post Ideas only. Replies still never leave this browser without you.
        </p>
        {posting ? (
          <>
            <Label htmlFor="ppd">Posts per day (1–10)</Label>
            <Input
              id="ppd"
              type="number"
              min={1}
              max={10}
              value={posting.postsPerDay}
              onChange={(e) => setPosting({ ...posting, postsPerDay: Number(e.target.value) })}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ws">Window start</Label>
                <Input
                  id="ws"
                  type="time"
                  value={posting.windowStart}
                  onChange={(e) => setPosting({ ...posting, windowStart: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="we">Window end</Label>
                <Input
                  id="we"
                  type="time"
                  value={posting.windowEnd}
                  onChange={(e) => setPosting({ ...posting, windowEnd: e.target.value })}
                />
              </div>
            </div>
            <Label htmlFor="tz">Audience timezone</Label>
            <Input
              id="tz"
              value={posting.timezone}
              onChange={(e) => setPosting({ ...posting, timezone: e.target.value })}
              placeholder="America/New_York"
            />
            <Button variant="outline" onClick={savePosting}>
              Save posting window
            </Button>
          </>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-2xl italic">Billing</h2>
        <p className="text-sm text-muted">
          {`Plan ${user?.plan ?? "trial"}${user?.billingPaused ? " · paused after a failed payment" : ""}. Credit packs never expire.`}
        </p>
        {!stripeOn ? (
          <p className="text-sm text-pause">
            Stripe is not configured. Prices below are real; checkout will not charge until STRIPE_SECRET_KEY is set.
          </p>
        ) : null}
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="rounded-md border border-line p-4">
              <p className="font-medium">
                {p.name} · ${p.monthlyUsd}/mo or ${p.yearlyUsd}/yr
              </p>
              <p className="mt-1 text-sm text-muted">
                {p.credits} plan credits · {p.accounts} accounts. {p.blurb}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="paper" disabled={!stripeOn || busy !== null} onClick={() => checkout(`${p.id}_month`)}>
                  Monthly
                </Button>
                <Button size="sm" variant="outline" disabled={!stripeOn || busy !== null} onClick={() => checkout(`${p.id}_year`)}>
                  Yearly (10 months for 12)
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <h3 className="pt-2 text-sm uppercase tracking-widest text-faint">Credit packs</h3>
        <ul className="flex flex-wrap gap-2">
          {packs.map((pack) => (
            <li key={pack.sku}>
              <Button size="sm" variant="outline" disabled={!stripeOn || busy !== null} onClick={() => checkout(pack.sku)}>
                {pack.credits} cr · ${pack.usd}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
