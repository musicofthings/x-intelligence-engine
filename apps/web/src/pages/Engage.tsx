import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Envelope } from "../lib/api";
import { Card, Loading, ErrorState, EmptyState, Button, ScoreBadge } from "../components/ui";
import { timeAgo } from "../lib/format";
import type {
  Campaign, EngageItem, EngageStats, EngagementSession, Network, ReplyDraft, SafetyReport, XOAuthStatus,
} from "../lib/types";

/**
 * Engage inbox: a score-ranked triage queue with AI drafting, deterministic pre-send
 * checks, and one-click send.
 *
 * There is no auto-send and no bulk action anywhere on this page — every reply is
 * reviewed and sent individually, which is also enforced server-side.
 */
export function Engage() {
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState<string>("");
  const [network, setNetwork] = useState<Network | "">("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  /**
   * Post ids acted on in this sitting. Filtering client-side keeps the cursor stable:
   * a skip removes the item from the server queue on the next refetch, but a send does
   * not, so relying on the refetch alone would either skip or re-show items.
   */
  const [handled, setHandled] = useState<Set<string>>(new Set());

  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<Envelope<Campaign[]>>("/campaigns"),
  });

  const queue = useQuery({
    queryKey: ["engage-queue", campaignId, network],
    queryFn: () =>
      api.get<{ data: EngageItem[]; meta: { candidates: number; signals_observed: number } }>(
        `/engage/queue?${new URLSearchParams({
          ...(campaignId ? { campaign: campaignId } : {}),
          ...(network ? { network } : {}),
        })}`,
      ),
  });

  const stats = useQuery({
    queryKey: ["engage-stats"],
    queryFn: () => api.get<Envelope<EngageStats>>("/engage/stats"),
  });

  const session = useQuery({
    queryKey: ["engage-session", sessionId],
    queryFn: () =>
      api.get<Envelope<{ session: EngagementSession; live: Record<string, number> }>>(`/engage/sessions/${sessionId}`),
    enabled: !!sessionId,
  });

  const startSession = useMutation({
    mutationFn: () =>
      api.post<Envelope<EngagementSession>>("/engage/sessions", { campaign_id: campaignId || null }),
    onSuccess: (r) => setSessionId(r.data.id),
  });

  const endSession = useMutation({
    mutationFn: () => api.post<Envelope<EngagementSession>>(`/engage/sessions/${sessionId}/end`, {}),
    onSuccess: () => {
      setSessionId(null);
      qc.invalidateQueries({ queryKey: ["engage-stats"] });
    },
  });

  const all = queue.data?.data ?? [];
  const items = useMemo(() => all.filter((i) => !handled.has(i.post.id)), [all, handled]);
  const current = items[cursor];

  useEffect(() => {
    setCursor(0);
    setHandled(new Set());
  }, [campaignId, network]);

  /** Acted on: drop it from the list. The cursor already points at the next item. */
  const onHandled = (postId: string) => {
    setHandled((h) => new Set(h).add(postId));
    qc.invalidateQueries({ queryKey: ["engage-queue"] });
  };

  /** Passed over without a decision: leave it in the queue, just move on. */
  const onNext = () => setCursor((i) => i + 1);

  if (campaigns.isLoading || queue.isLoading) return <Loading />;
  if (queue.error) return <ErrorState message={(queue.error as Error).message} />;

  const s = stats.data?.data;
  const live = session.data?.data.live;
  const goal = session.data?.data.session.goal ?? s?.daily_goal ?? 10;
  const done = live?.replied ?? s?.replies_today ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Engage</h1>
          <p className="text-sm text-fg-subtle">
            Ranked by strategic score, freshness, and what you've engaged with before.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-fg-muted">
            Campaign
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="mt-1 block w-44 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
            >
              <option value="">All campaigns</option>
              {(campaigns.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-muted">
            Network
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as Network | "")}
              className="mt-1 block w-32 rounded border border-line bg-bg px-2 py-1 text-sm text-fg"
            >
              <option value="">Both</option>
              <option value="x">X</option>
              <option value="reddit">Reddit</option>
            </select>
          </label>
          {sessionId ? (
            <Button onClick={() => endSession.mutate()} disabled={endSession.isPending}>End session</Button>
          ) : (
            <Button variant="primary" onClick={() => startSession.mutate()} disabled={startSession.isPending}>
              Start session
            </Button>
          )}
        </div>
      </header>

      <GoalBar done={done} goal={goal} live={live} sessionActive={!!sessionId} />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing in the queue."
          hint={`${queue.data?.meta.candidates ?? 0} posts considered. Lower the score threshold, widen the window, or wait for the next collection run.`}
        />
      ) : !current ? (
        <EmptyState
          title="Queue cleared."
          hint="Every item in this batch has been triaged or passed over."
        />
      ) : (
        <EngageCard
          key={current.post.id}
          item={current}
          campaignId={campaignId || null}
          sessionId={sessionId}
          position={cursor + 1}
          total={items.length}
          onHandled={() => onHandled(current.post.id)}
          onNext={onNext}
        />
      )}

      {s && <LearningPanel stats={s} />}
    </div>
  );
}

function GoalBar({
  done, goal, live, sessionActive,
}: {
  done: number; goal: number; live?: Record<string, number>; sessionActive: boolean;
}) {
  const pct = goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-fg">
          <span className="font-semibold">{done}</span>
          <span className="text-fg-muted"> / {goal} replies {sessionActive ? "this session" : "today"}</span>
        </div>
        {live && (
          <div className="flex gap-4 text-xs text-fg-muted">
            <span>reviewed {live.reviewed ?? 0}</span>
            <span>drafted {live.drafted ?? 0}</span>
            <span>skipped {live.skipped ?? 0}</span>
          </div>
        )}
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-elevated">
        <div
          className={`h-full ${pct >= 100 ? "bg-teal-500" : "bg-sky-600"}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={goal}
        />
      </div>
    </Card>
  );
}

function EngageCard({
  item, campaignId, sessionId, position, total, onHandled, onNext,
}: {
  item: EngageItem; campaignId: string | null; sessionId: string | null;
  position: number; total: number; onHandled: () => void; onNext: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [safety, setSafety] = useState<SafetyReport | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isX = item.post.network === "x";

  const oauth = useQuery({
    queryKey: ["oauth-x"],
    queryFn: () => api.get<Envelope<XOAuthStatus>>("/oauth/x/status"),
  });

  const record = (kind: string) =>
    api.post("/engage/events", {
      post_id: item.post.id, kind, session_id: sessionId, campaign_id: campaignId,
    });

  const draft = useMutation({
    mutationFn: () =>
      api.post<Envelope<{ draft: ReplyDraft; rationale: string; safety: SafetyReport }>>(
        `/posts/${item.post.id}/drafts`,
        { campaign_id: campaignId, session_id: sessionId },
      ),
    onSuccess: (r) => {
      setBody(r.data.draft.body);
      setDraftId(r.data.draft.id);
      setRationale(r.data.rationale);
      setSafety(r.data.safety);
      setDismissed([]);
      setError(null);
    },
    onError: (e) => setError(describeError(e)),
  });

  const transform = useMutation({
    mutationFn: (kind: string) =>
      api.post<Envelope<{ draft: ReplyDraft; rationale: string; safety: SafetyReport }>>(
        `/drafts/${draftId}/transform`,
        { transform: kind, body },
      ),
    onSuccess: (r) => {
      setBody(r.data.draft.body);
      setDraftId(r.data.draft.id);
      setRationale(r.data.rationale);
      setSafety(r.data.safety);
      setDismissed([]);
      setError(null);
    },
    onError: (e) => setError(describeError(e)),
  });

  const check = useMutation({
    mutationFn: () =>
      api.post<Envelope<SafetyReport>>("/engage/check", { body, network: item.post.network }),
    onSuccess: (r) => setSafety(r.data),
  });

  const send = useMutation({
    mutationFn: () =>
      api.post<Envelope<{ sent: boolean; already_sent: boolean; external_reply_id?: string }>>(
        `/drafts/${draftId}/send`,
        { body, session_id: sessionId, acknowledged_warnings: dismissed },
      ),
    onSuccess: (r) => {
      setSent(r.data.external_reply_id ?? "sent");
      setError(null);
      qc.invalidateQueries({ queryKey: ["engage-stats"] });
      qc.invalidateQueries({ queryKey: ["engage-session"] });
    },
    onError: (e) => setError(describeError(e)),
  });

  const skip = useMutation({
    mutationFn: () => record("skipped"),
    onSuccess: onHandled,
  });

  const blocking = useMemo(
    () => (safety?.warnings ?? []).filter((w) => w.severity === "block"),
    [safety],
  );
  const openWarnings = useMemo(
    () => (safety?.warnings ?? []).filter((w) => w.severity === "warn" && !dismissed.includes(w.code)),
    [safety, dismissed],
  );

  const canSend = isX && !!draftId && !!body.trim() && blocking.length === 0 && !sent && !!oauth.data?.data.connected;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs ${isX ? "bg-sky-600/20 text-sky-300" : "bg-orange-600/20 text-orange-300"}`}>
              {isX ? "X" : "Reddit"}
            </span>
            <span className="font-medium text-fg">
              {item.post.authorUsername ? `@${item.post.authorUsername}` : "unknown author"}
            </span>
            <span className="text-xs text-fg-subtle">{timeAgo(item.post.createdAt)}</span>
            <ScoreBadge label="queue" score={item.queueScore} />
            {item.strategicScore != null && <ScoreBadge label="strategic" score={item.strategicScore} />}
          </div>
          <div className="mt-1 text-xs text-fg-subtle">
            {item.reasons.join(" · ")}
            {item.monitorNames.length > 0 && ` · ${item.monitorNames.join(", ")}`}
          </div>
        </div>
        <div className="shrink-0 text-xs text-fg-subtle">{position} of {total}</div>
      </div>

      {/* External content is rendered as plain text — never as HTML. */}
      <p className="whitespace-pre-wrap text-sm text-fg">{item.post.text}</p>
      {item.summary && <p className="mt-2 text-xs text-fg-muted">Screening: {item.summary}</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-fg-subtle">
        <span>{item.post.metrics.likeCount} likes</span>
        <span>{item.post.metrics.replyCount} replies</span>
        {item.post.url && (
          <a href={item.post.url} target="_blank" rel="noreferrer noopener" className="text-sky-400 hover:underline">
            Open original
          </a>
        )}
      </div>

      <div className="mt-4 space-y-2 border-t border-line pt-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => draft.mutate()} disabled={draft.isPending}>
            {draft.isPending ? "Drafting…" : draftId ? "Draft again" : "Draft reply"}
          </Button>
          {draftId && (["rewrite", "autocomplete", "shorter", "longer"] as const).map((t) => (
            <Button key={t} onClick={() => transform.mutate(t)} disabled={transform.isPending || !body.trim()}>
              {t}
            </Button>
          ))}
        </div>

        {(draftId || body) && (
          <>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setSafety(null); }}
              onBlur={() => body.trim() && check.mutate()}
              rows={4}
              disabled={!!sent}
              className="mt-2 block w-full rounded border border-line bg-bg px-2 py-1 text-sm text-fg disabled:opacity-60"
              placeholder="Your reply…"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-subtle">
              <span>{body.length} characters</span>
              {rationale && <span className="text-fg-muted">Why: {rationale}</span>}
            </div>
          </>
        )}

        {blocking.map((w) => (
          <div key={w.code} className="rounded border border-red-900/50 bg-red-950/30 p-2 text-xs text-red-300" role="alert">
            <strong>Blocked:</strong> {w.message}
          </div>
        ))}

        {openWarnings.map((w) => (
          <div key={w.code} className="flex items-start justify-between gap-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-xs text-amber-300">
            <span>
              {w.message}
              {w.evidence && <span className="ml-1 opacity-70">— “{w.evidence}”</span>}
            </span>
            <button onClick={() => setDismissed((d) => [...d, w.code])} className="shrink-0 underline">
              dismiss
            </button>
          </div>
        ))}

        {safety && safety.warnings.length === 0 && body.trim() && (
          <div className="text-xs text-teal-400">Pre-send checks passed.</div>
        )}

        {!isX && (
          <div className="rounded border border-line bg-elevated/40 p-2 text-xs text-fg-muted">
            Sending is X-only. Copy the draft and reply in the Reddit thread.
          </div>
        )}
        {isX && oauth.data && !oauth.data.data.connected && (
          <div className="rounded border border-line bg-elevated/40 p-2 text-xs text-fg-muted">
            {oauth.data.data.configured
              ? "No X account connected — connect one in Settings to send replies."
              : `X OAuth is not configured (missing: ${oauth.data.data.missing.join(", ")}).`}
          </div>
        )}

        {error && <ErrorState message={error} />}
        {sent && <div className="text-xs text-teal-400">Reply sent.</div>}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" onClick={() => send.mutate()} disabled={!canSend || send.isPending}>
            {send.isPending ? "Sending…" : "Send reply"}
          </Button>
          <Button onClick={() => navigator.clipboard?.writeText(body)} disabled={!body.trim()}>
            Copy
          </Button>
          <Button onClick={() => skip.mutate()} disabled={skip.isPending || !!sent}>Skip</Button>
          <Button onClick={sent ? onHandled : onNext}>{sent ? "Next" : "Next (no decision)"}</Button>
        </div>
      </div>
    </Card>
  );
}

function LearningPanel({ stats }: { stats: EngageStats }) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-fg">What the queue has learned</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        {stats.learning.observations} decisions recorded ({stats.learning.engaged} engaged,{" "}
        {stats.learning.skipped} skipped). Ranking uses these counts directly — no hidden model.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AffinityList title="Authors" rows={stats.learning.top_authors} />
        <AffinityList title="Topics" rows={stats.learning.top_topics} />
      </div>
    </Card>
  );
}

function AffinityList({ title, rows }: { title: string; rows: { key: string; net: number }[] }) {
  if (rows.length === 0) return <div className="text-xs text-fg-subtle">{title}: no signal yet.</div>;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-subtle">{title}</div>
      <ul className="mt-1 space-y-0.5 text-xs">
        {rows.map((r) => (
          <li key={r.key} className="flex justify-between gap-2">
            <span className="truncate text-fg-muted">{r.key}</span>
            <span className={r.net >= 0 ? "text-teal-400" : "text-red-400"}>
              {r.net > 0 ? `+${r.net}` : r.net}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "BUDGET_EXCEEDED") return "A configured budget or send cap has been reached.";
    if (e.code === "AUTHENTICATION_ERROR") return "The connected X account needs to be reconnected in Settings.";
    return `${e.code}: ${e.message}`;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
