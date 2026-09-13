"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { formatHumanTime, formatMmSs } from "@/lib/utils";
import { charLimitFor } from "@/lib/send/compose";
import type { Campaign, Network, SafetyReport, SessionSnapshot } from "@/lib/types";

async function action(body: unknown): Promise<SessionSnapshot> {
  const res = await fetch("/api/session/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as SessionSnapshot;
}

export function SessionCockpit({
  initial,
  campaigns,
}: {
  initial: SessionSnapshot;
  campaigns: Campaign[];
}) {
  const [snap, setSnap] = useState(initial);
  const [edited, setEdited] = useState<{ id: string; text: string } | null>(null);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [networks, setNetworks] = useState<Network[]>(["x"]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [safety, setSafety] = useState<SafetyReport | null>(null);
  const [sendHint, setSendHint] = useState<string | null>(null);
  const lastBeat = useRef(Date.now());
  const draft = edited && edited.id === snap.current?.id ? edited.text : (snap.current?.draft ?? "");
  const state = snap.session?.state ?? "precheck";
  const live = state === "live";

  const beat = useCallback(async (activity = false) => {
    const elapsed = Date.now() - lastBeat.current;
    lastBeat.current = Date.now();
    try {
      const next = await action({ action: "heartbeat", elapsedMs: elapsed, activity });
      setSnap(next);
    } catch {
      /* keep last snapshot */
    }
  }, []);

  useEffect(() => {
    if (state === "stopped" || !snap.session) return;
    const t = setInterval(() => void beat(false), 2000);
    return () => clearInterval(t);
  }, [beat, snap.session, state]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void onReply();
        }
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        void onPass();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void onReply();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const chip = useMemo(() => {
    if (state === "live") return { label: "Queue live", cls: "text-live" };
    if (state === "credit_pause") return { label: "Credits paused", cls: "text-pause" };
    if (state === "idle_pause") return { label: "Paused", cls: "text-pause" };
    if (state === "stopped") return { label: "Stopped", cls: "text-faint" };
    return { label: "Ready", cls: "text-muted" };
  }, [state]);

  async function onStart() {
    try {
      const next = await action({ action: "start", campaignId, networks });
      lastBeat.current = Date.now();
      setSnap(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start");
    }
  }

  async function onPass() {
    if (!snap.current) return;
    const next = await fetch(`/api/cards/${snap.current.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pass" }),
    }).then((r) => r.json());
    setSnap(next);
    setConfirmOpen(false);
  }

  async function onReply() {
    if (!snap.current) return;
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId: snap.current.id, draft }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Cannot send");
      return;
    }
    setSafety(data.safety);
    setSendHint(data.send.instruction);
    try {
      await navigator.clipboard.writeText(data.send.copyText);
    } catch {
      /* clipboard may be denied */
    }
    window.open(data.send.openUrl, "_blank", "noopener,noreferrer");
    setConfirmOpen(true);
  }

  async function confirmPosted() {
    if (!snap.current) return;
    const next = await fetch(`/api/cards/${snap.current.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "confirm", draft }),
    }).then((r) => r.json());
    setSnap(next);
    setConfirmOpen(false);
    toast("Logged. We still never posted it for you.");
  }

  async function rewrite(job: "shorter" | "longer" | "rewrite") {
    if (!snap.current) return;
    const res = await fetch(`/api/cards/${snap.current.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rewrite", job, draft }),
    });
    const data = await res.json();
    if (data.card) {
      setEdited({ id: data.card.id, text: data.card.draft });
      setSnap((s) => ({ ...s, current: data.card }));
    }
  }

  async function block(kind: "block" | "block24") {
    if (!snap.current) return;
    const next = await fetch(`/api/cards/${snap.current.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: kind }),
    }).then((r) => r.json());
    setSnap(next);
  }

  const card = snap.current;
  const limit = card ? charLimitFor(card.post.network) : 280;

  if (campaigns.length === 0) {
    return (
      <EmptyShell>
        <p className="font-display text-3xl italic">Set a strategy first.</p>
        <p className="mt-3 text-muted">A round needs a campaign — who you are, who you want to reach.</p>
        <Button asChild variant="paper" className="mt-6">
          <Link href="/app/onboarding">Open setup</Link>
        </Button>
      </EmptyShell>
    );
  }

  if (!snap.session || state === "stopped" || state === "precheck") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-16">
        <h1 className="font-display text-4xl italic">Start a round</h1>
        <p className="text-muted">Scanning runs only while live. Idle and reading are free.</p>
        <label className="text-sm text-muted">
          Campaign
          <select
            className="mt-2 flex h-11 w-full rounded-md border border-line bg-chrome-2 px-3 text-ink"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex gap-4 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={networks.includes("x")} onChange={() => toggle(setNetworks, "x")} />
            X {snap.xConfigured ? "" : "(mock)"}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={networks.includes("reddit")} onChange={() => toggle(setNetworks, "reddit")} />
            Reddit
          </label>
        </fieldset>
        {!snap.xConfigured ? (
          <p className="text-sm text-pause">X API keys are not set. The mock adapter is on — this is not production X.</p>
        ) : null}
        <p className="tabular text-sm text-muted">{snap.credits.total} credits · plan {snap.credits.plan} · permanent {snap.credits.permanent}</p>
        {snap.billingPaused ? (
          <p className="text-sm text-pause">
            Billing is paused after a failed payment.{" "}
            <Link href="/app/settings" className="underline">
              Update billing
            </Link>
          </p>
        ) : null}
        {snap.trialExpired ? (
          <p className="text-sm text-pause">
            The trial has ended.{" "}
            <Link href="/app/settings" className="underline">
              Pick a plan
            </Link>{" "}
            to keep running rounds.
          </p>
        ) : null}
        <Button variant="paper" onClick={onStart} disabled={snap.credits.total < 3 || networks.length === 0 || snap.billingPaused || snap.trialExpired}>
          Start
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className={`tabular ${chip.cls}`}>{chip.label}</span>
          <span className="tabular text-xl tracking-tight">{formatMmSs(snap.session.liveMs)}</span>
          <span className="text-muted tabular">
            {snap.session.repliesCount} replies · {snap.queue.length + (card ? 1 : 0)} in queue
          </span>
          <span className="tabular text-muted">{snap.credits.total} cr</span>
        </div>
        <div className="flex gap-2">
          {live ? (
            <Button size="sm" variant="outline" onClick={() => action({ action: "pause" }).then(setSnap)}>
              Pause
            </Button>
          ) : (
            <Button size="sm" variant="paper" onClick={() => action({ action: "resume" }).then(setSnap)}>
              Resume
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => action({ action: "stop" }).then(setSnap)}>
            Stop
          </Button>
        </div>
      </div>

      {state === "idle_pause" ? (
        <div className="border-b border-line bg-chrome-2 px-4 py-3 text-sm text-muted">
          Round paused. The queue is still here. Resume when you are back.
        </div>
      ) : null}
      {state === "credit_pause" ? (
        <div className="border-b border-line bg-chrome-2 px-4 py-3 text-sm text-pause">
          Credits are empty. The current card stays. Top up to scan again.
        </div>
      ) : null}

      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-6 p-4 md:grid-cols-2 md:p-8">
        {card ? (
          <>
            <article className="rounded-lg bg-paper p-6 text-paper-ink">
              <p className="text-xs uppercase tracking-widest text-paper-muted">
                @{card.post.authorHandle}
                {card.frequent ? " · frequent" : ""} · {formatHumanTime(card.post.createdAt)} · {card.post.network}
                {card.post.adapter === "mock_x" ? " · mock" : ""}
              </p>
              <p className="mt-4 whitespace-pre-wrap font-display text-2xl leading-snug">{card.post.body}</p>
              {card.post.media[0]?.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.post.media[0].url} alt="" className="mt-4 max-h-64 rounded-md object-cover" />
              ) : null}
              <p className="mt-6 text-sm text-paper-muted">{card.score.label}</p>
              {card.post.network === "x" ? (
                <p className="mt-3 tabular text-xs text-paper-muted">
                  {card.post.metrics.likes} likes · {card.post.metrics.replies} replies · {card.post.metrics.reposts}{" "}
                  reposts · {card.post.metrics.saves} saves
                </p>
              ) : (
                <p className="mt-3 tabular text-xs text-paper-muted">
                  {card.post.metrics.likes} ups · {card.post.metrics.comments} comments
                </p>
              )}
            </article>
            <div className="flex flex-col">
              <label className="text-xs uppercase tracking-widest text-faint">Draft</label>
              <Textarea
                value={draft}
                onChange={(e) => {
                  if (card) setEdited({ id: card.id, text: e.target.value });
                }}
                className="mt-2 min-h-48 bg-chrome-2"
                aria-label="Reply draft"
              />
              {card.post.network === "x" ? (
                <p className="mt-2 tabular text-xs text-muted">{Math.max(0, limit - draft.length)} characters remaining</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => rewrite("shorter")}>
                  Shorter
                </Button>
                <Button size="sm" variant="outline" onClick={() => rewrite("longer")}>
                  Longer
                </Button>
                <Button size="sm" variant="outline" onClick={() => rewrite("rewrite")}>
                  Rewrite
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button variant="paper" onClick={onReply}>
                  Reply
                </Button>
                <Button variant="pass" onClick={onPass}>
                  Pass — teaches the filter
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {card.post.network === "x" ? (
                  <>
                    <a className="min-h-11 inline-flex items-center text-muted hover:text-ink" href={card.post.url} target="_blank" rel="noreferrer">
                      Like
                    </a>
                    <a className="min-h-11 inline-flex items-center text-muted hover:text-ink" href={`https://x.com/messages/compose?recipient_id=${card.post.authorHandle}`} target="_blank" rel="noreferrer">
                      DM
                    </a>
                  </>
                ) : (
                  <a className="min-h-11 inline-flex items-center text-muted hover:text-ink" href={card.post.url} target="_blank" rel="noreferrer">
                    Vote on Reddit
                  </a>
                )}
                <button type="button" className="min-h-11 text-muted hover:text-ink" onClick={() => block("block24")}>
                  Block 24h
                </button>
                <button type="button" className="min-h-11 text-muted hover:text-ink" onClick={() => block("block")}>
                  Block
                </button>
              </div>
              {safety?.warnings.length ? (
                <ul className="mt-4 space-y-1 text-sm text-pause">
                  {safety.warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              ) : null}
              {confirmOpen ? (
                <div className="mt-6 rounded-md border border-line p-4">
                  <p className="text-sm text-muted">{sendHint}</p>
                  <p className="mt-2 text-sm">We never post a reply without you. Mark it only after it is live.</p>
                  <Button className="mt-3" variant="copper" onClick={confirmPosted}>
                    I posted it
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="md:col-span-2 py-16 text-center">
            <p className="font-display text-3xl italic">Queue is quiet.</p>
            <p className="mt-3 text-muted">
              {live ? "Waiting on fresh matches. You can refine the filter or stop." : "Resume to keep working the cards you already have."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function toggle(set: (fn: (n: Network[]) => Network[]) => void, n: Network) {
  set((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
}

function EmptyShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg px-4 py-20 text-center">{children}</div>;
}
