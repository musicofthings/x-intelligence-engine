import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Envelope } from "../lib/api";
import { Card, ScoreBadge, Loading, ErrorState, Button } from "../components/ui";
import { timeAgo } from "../lib/format";

interface Detail {
  post: {
    id: string; xPostId: string; authorUsername: string | null; authorName: string | null;
    text: string; createdAt: string; url: string | null; conversationId: string | null;
    metrics: Record<string, number>; raw: unknown;
  };
  screening: null | {
    relevanceScore: number; noveltyScore: number; credibilityScore: number; strategicImportanceScore: number;
    topic: string; subtopic: string; reason: string; summary: string; recommendedAction: string;
    entities: { name: string; type: string }[]; risks: string[]; model: string; promptVersion: string; scoredAt: string;
  };
  state: null | { isRead: boolean; isStarred: boolean; isArchived: boolean; notes: string | null };
}

export function PostDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["post", id],
    queryFn: () => api.get<Envelope<Detail>>(`/posts/${id}`),
  });

  const patchState = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/posts/${id}/state`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["post", id] }),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState message={(error as Error).message} />;
  const { post, screening, state } = data!.data;

  return (
    <div className="space-y-4">
      <Link to="/posts" className="text-sm text-sky-400 hover:underline">← Back to feed</Link>
      <Card>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-100">{post.authorName}</span>
          <span className="text-slate-500">@{post.authorUsername}</span>
          <span className="text-slate-600">· {timeAgo(post.createdAt)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-slate-200">{post.text}</p>
        <div className="mt-3 flex gap-3 text-xs text-slate-500">
          {Object.entries(post.metrics).map(([k, v]) => (
            <span key={k}>{k}: {v}</span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => patchState.mutate({ is_starred: !(state?.isStarred) })}>
            {state?.isStarred ? "★ Unstar" : "☆ Star"}
          </Button>
          <Button onClick={() => patchState.mutate({ is_read: true })}>Mark read</Button>
          <Button onClick={() => patchState.mutate({ is_archived: !(state?.isArchived) })}>
            {state?.isArchived ? "Unarchive" : "Archive"}
          </Button>
          <Button variant="danger" onClick={() => patchState.mutate({ is_dismissed: true })}>Dismiss</Button>
          {post.url && (
            <a href={post.url} target="_blank" rel="noreferrer noopener" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700">
              Original ↗
            </a>
          )}
        </div>
      </Card>

      {screening ? (
        <Card>
          <div className="mb-3 flex flex-wrap gap-2">
            <ScoreBadge label="relevance" score={screening.relevanceScore} />
            <ScoreBadge label="novelty" score={screening.noveltyScore} />
            <ScoreBadge label="credibility" score={screening.credibilityScore} />
            <ScoreBadge label="strategic" score={screening.strategicImportanceScore} />
          </div>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-slate-500">Topic</dt><dd className="text-slate-200">{screening.topic} / {screening.subtopic}</dd></div>
            <div><dt className="text-slate-500">Summary</dt><dd className="text-slate-200">{screening.summary}</dd></div>
            <div><dt className="text-slate-500">Reason</dt><dd className="text-slate-300">{screening.reason}</dd></div>
            <div><dt className="text-slate-500">Recommended action</dt><dd className="text-slate-300">{screening.recommendedAction}</dd></div>
            {screening.entities.length > 0 && (
              <div>
                <dt className="text-slate-500">Entities</dt>
                <dd className="flex flex-wrap gap-1">
                  {screening.entities.map((e, i) => (
                    <span key={i} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">{e.name} · {e.type}</span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-slate-600">Model {screening.model} · prompt {screening.promptVersion} · {timeAgo(screening.scoredAt)}</p>
        </Card>
      ) : (
        <Card><p className="text-sm text-slate-500">Not yet screened by Claude.</p></Card>
      )}

      <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <summary className="cursor-pointer text-sm text-slate-400">Raw source payload (developer view)</summary>
        <pre className="mt-2 max-h-80 overflow-auto text-xs text-slate-500">{JSON.stringify(post.raw, null, 2)}</pre>
      </details>
    </div>
  );
}
