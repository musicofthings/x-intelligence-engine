"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { PostIdea, PostingSettings } from "@/lib/types";

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<PostIdea[]>([]);
  const [posting, setPosting] = useState<PostingSettings | null>(null);
  const [min, setMin] = useState(12);
  const [toward, setToward] = useState(0);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/ideas");
    const data = (await res.json()) as {
      ideas?: PostIdea[];
      posting?: PostingSettings;
      distillMin?: number;
      xRepliesTowardDistill?: number;
    };
    setIdeas(data.ideas ?? []);
    setPosting(data.posting ?? null);
    if (data.distillMin) setMin(data.distillMin);
    setToward(data.xRepliesTowardDistill ?? 0);
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(idea: PostIdea, action: "save" | "approve" | "drop") {
    setError(null);
    const res = await fetch("/api/ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ideaId: idea.id, text: edits[idea.id] ?? idea.text, action }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not update idea");
      return;
    }
    await load();
  }

  const open = ideas.filter((i) => i.status === "draft" || i.status === "approved" || i.status === "queued");
  const done = ideas.filter((i) => i.status === "posted" || i.status === "failed" || i.status === "expired");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-4xl italic">Post ideas</h1>
      <p className="mt-4 text-muted">
        After a round with about {min} X replies, LiveRound distills standalone posts in your words. You approve the
        exact text. That is the only server-side publish path — original posts, never replies.
      </p>
      {posting ? (
        <p className="mt-2 text-sm text-faint">
          {posting.postsPerDay}/day between {posting.windowStart}–{posting.windowEnd} {posting.timezone}. Last round:{" "}
          {Math.min(toward, min)} / {min} X replies toward a distill.
        </p>
      ) : (
        <p className="mt-2 text-sm text-faint">
          Last round: {Math.min(toward, min)} / {min} X replies toward a distill.
        </p>
      )}
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {open.length === 0 ? (
        <p className="mt-10 text-muted">None waiting. Finish a round with enough X replies and they will land here.</p>
      ) : (
        <ul className="mt-8 space-y-6">
          {open.map((idea) => (
            <li key={idea.id} className="rounded-lg border border-line p-4">
              <p className="text-xs uppercase tracking-widest text-faint">
                {idea.status}
                {idea.scheduledAt ? ` · ${new Date(idea.scheduledAt).toLocaleString()}` : ""}
              </p>
              <Textarea
                className="mt-3"
                value={edits[idea.id] ?? idea.text}
                onChange={(e) => setEdits((m) => ({ ...m, [idea.id]: e.target.value }))}
                disabled={idea.status !== "draft"}
              />
              {idea.status === "draft" ? (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="paper" onClick={() => act(idea, "approve")}>
                    Approve this text
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act(idea, "save")}>
                    Save edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => act(idea, "drop")}>
                    Drop
                  </Button>
                </div>
              ) : null}
              {idea.failReason ? <p className="mt-2 text-sm text-pause">{idea.failReason}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {done.length ? (
        <section className="mt-12">
          <h2 className="font-display text-2xl italic">History</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted">
            {done.map((idea) => (
              <li key={idea.id}>
                {idea.status}: {idea.text.slice(0, 120)}
                {idea.failReason ? ` — ${idea.failReason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
