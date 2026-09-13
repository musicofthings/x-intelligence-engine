"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { SocialAccount, WritingSettings } from "@/lib/types";

export default function SettingsPage() {
  const [bio, setBio] = useState("");
  const [notes, setNotes] = useState("");
  const [length, setLength] = useState(50);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [xConfigured, setX] = useState(true);
  const [redditConfigured, setR] = useState(false);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { writing?: WritingSettings; accounts?: SocialAccount[] }) => {
        if (d.writing) {
          setBio(d.writing.bio);
          setNotes(d.writing.writingNotes);
          setLength(d.writing.replyLength);
        }
        setAccounts(d.accounts ?? []);
      });
    void fetch("/api/session")
      .then((r) => r.json())
      .then((d: { xConfigured?: boolean; redditConfigured?: boolean }) => {
        setX(Boolean(d.xConfigured));
        setR(Boolean(d.redditConfigured));
      });
  }, []);

  async function save() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio, writingNotes: notes, replyLength: length }),
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <h1 className="font-display text-4xl italic">Writing</h1>
      {!xConfigured ? (
        <div className="rounded-md border border-pause/40 bg-chrome-2 p-4 text-sm text-pause">
          X API keys are missing. Discovery uses the mock adapter. This is not production X. Connect keys
          via X_CLIENT_ID and X_CLIENT_SECRET when you have them.
        </div>
      ) : null}
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
      <section>
        <h2 className="font-display text-2xl italic">Accounts</h2>
        <p className="mt-2 text-sm text-muted">
          App accounts are yours. Social accounts connect later via OAuth. Reddit configured: {redditConfigured ? "yes" : "no"}.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {accounts.map((a) => (
            <li key={a.id} className="rounded-md border border-line px-4 py-3">
              {a.displayName} · {a.provider} · {a.status}
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-2">
          <Input disabled placeholder="X OAuth — Phase 2 when keys exist" />
          <Input disabled placeholder="Reddit OAuth — connect from env" />
        </div>
      </section>
    </div>
  );
}
