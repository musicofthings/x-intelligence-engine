import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <Wordmark className="text-lg" />
        <nav className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-muted hover:text-ink min-h-11 inline-flex items-center">
            Sign in
          </Link>
          <Button asChild variant="paper" size="sm">
            <Link href="/login">Start a round</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        <section className="px-6 pb-20 pt-10 md:px-10 md:pt-16">
          <p className="text-xs uppercase tracking-[0.18em] text-faint">Human press, always</p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.15] tracking-tight md:text-6xl">
            Sit down for fifteen minutes.
            <span className="italic text-muted"> Join conversations already happening.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            LiveRound streams matching posts from X and Reddit into a one-card inbox, drafts a reply in
            your voice, and waits. You press Reply. We never do.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="paper">
              <Link href="/login">Open the cockpit</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="#loop">How a round works</Link>
            </Button>
          </div>
          <p className="mt-6 max-w-lg text-sm text-faint">
            Five thoughtful replies beat twenty rushed ones. Credits meter scanning, filtering, and
            drafting — not the time you spend reading.
          </p>
        </section>

        <section className="mx-6 mb-16 overflow-hidden rounded-lg border border-line bg-chrome-2 md:mx-10">
          <div className="flex items-center justify-between border-b border-line px-5 py-3 text-sm">
            <Wordmark className="text-base" />
            <div className="flex items-center gap-4 tabular text-muted">
              <span className="text-live">Queue live</span>
              <span>12:41</span>
              <span>3 replies · 4 in queue</span>
              <span>38 cr</span>
            </div>
          </div>
          <div className="grid gap-0 md:grid-cols-2">
            <article className="bg-paper p-6 text-paper-ink md:p-8">
              <p className="text-xs uppercase tracking-widest text-paper-muted">@mira_builds · 6m ago</p>
              <p className="mt-3 font-display text-xl leading-snug">
                Anyone else finding that inbound is mostly people who saw a comment, not a launch post?
              </p>
              <p className="mt-4 text-sm text-paper-muted">
                Strong match — this is the conversation you described.
              </p>
            </article>
            <div className="p-6 md:p-8">
              <p className="text-xs uppercase tracking-widest text-faint">Draft in your voice</p>
              <p className="mt-3 text-ink">
                The comment is the actual surface. We stopped treating original posts as the engine and
                started sitting for a live pass instead — same pattern you’re seeing.
              </p>
              <div className="mt-6 flex gap-2">
                <span className="rounded-md bg-paper px-4 py-2 text-sm text-paper-ink">Reply</span>
                <span className="rounded-md border border-line px-4 py-2 text-sm text-muted">Pass — teaches the filter</span>
              </div>
            </div>
          </div>
        </section>

        <section id="loop" className="px-6 pb-20 md:px-10">
          <h2 className="font-display text-3xl italic">The round</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-4">
            {[
              {
                n: "01",
                t: "Set strategy",
                b: "Who you are, who you want to reach. Search rules on X, subreddits on Reddit, plus a filter document.",
              },
              {
                n: "02",
                t: "Start a round",
                b: "A timed live session. Matching posts stream in, freshest and highest score first.",
              },
              {
                n: "03",
                t: "Reply or pass",
                b: "One card. A draft already in your voice. Pass teaches the filter. We never post a reply without you.",
              },
              {
                n: "04",
                t: "Turn replies into posts",
                b: "After the round, distill what you already said into original posts. You approve the exact text.",
              },
            ].map((s) => (
              <li key={s.n}>
                <p className="tabular text-xs text-copper">{s.n}</p>
                <h3 className="mt-2 font-medium">{s.t}</h3>
                <p className="mt-2 text-sm text-muted">{s.b}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-line px-6 py-8 text-sm text-faint md:px-10">
        <p>LiveRound never posts a reply without you. OAuth only. No pods, no mass DMs, no unattended agents.</p>
      </footer>
    </div>
  );
}
