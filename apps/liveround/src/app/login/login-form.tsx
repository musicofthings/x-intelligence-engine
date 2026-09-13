"use client";

import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    setPreview(null);
    const res = await fetch("/api/auth/magic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as { error?: string; previewUrl?: string; emailed?: boolean; message?: string };
    setBusy(false);
    if (!res.ok) {
      setStatus(data.error ?? "Could not send a link.");
      return;
    }
    if (data.previewUrl) setPreview(data.previewUrl);
    setStatus(data.emailed ? "Check your email for a sign-in link." : (data.message ?? "Link ready."));
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <Link href="/" className="mb-10">
        <Wordmark className="text-xl" />
      </Link>
      <div className="w-full max-w-md rounded-lg border border-line bg-chrome-2 p-8">
        <h1 className="font-display text-3xl italic">Sit down.</h1>
        <p className="mt-2 text-sm text-muted">We’ll email a link. We never collect X or Reddit passwords.</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
            />
          </div>
          <Button type="submit" variant="paper" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Email me a link"}
          </Button>
        </form>
        {googleEnabled ? (
          <button
            type="button"
            className="mt-4 flex min-h-11 w-full items-center justify-center text-sm text-muted hover:text-ink"
            onClick={() => {
              window.location.href = "/api/auth/signin/google?callbackUrl=/app/session";
            }}
          >
            Continue with Google
          </button>
        ) : null}
        {status ? <p className="mt-4 text-sm text-muted">{status}</p> : null}
        {preview ? (
          <form action="/login/consume" method="post" className="mt-3">
            <input type="hidden" name="token" value={new URL(preview).searchParams.get("token") ?? ""} />
            <input type="hidden" name="email" value={email} />
            <button type="submit" className="text-sm text-copper underline-offset-4 hover:underline min-h-11">
              Open development sign-in
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
