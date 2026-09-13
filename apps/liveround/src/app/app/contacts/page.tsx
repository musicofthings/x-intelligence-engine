"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/types";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [unlocked, setUnlocked] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/contacts")
      .then((r) => r.json())
      .then((d: { contacts?: Contact[]; unlocked?: boolean; message?: string }) => {
        setContacts(d.contacts ?? []);
        setUnlocked(d.unlocked !== false);
        setMessage(d.message ?? null);
      });
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-4xl italic">Contacts</h1>
      <p className="mt-4 text-muted">
        Reciprocal over the last 30 days. One reply to a stranger does not create a contact — they have to write back.
      </p>
      {!unlocked ? (
        <p className="mt-8 text-pause">
          {message}{" "}
          <Link href="/app/settings" className="underline">
            Billing
          </Link>
        </p>
      ) : contacts.length === 0 ? (
        <p className="mt-10 text-muted">Nobody reciprocal yet. Keep showing up in living threads.</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md border border-line px-4 py-3">
              <div>
                <p className="font-medium">@{c.handle}</p>
                <p className="text-sm text-muted">
                  {c.network} · you {c.ourReplies} · them {c.theirReplies}
                </p>
              </div>
              <span className="tabular text-lg">{c.score}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
