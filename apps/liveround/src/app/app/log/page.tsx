import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listLogs } from "@/lib/db/store";
import { formatClock } from "@/lib/utils";

export default async function LogPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const logs = await listLogs(session.user.id);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-4xl italic">Reply log</h1>
      <p className="mt-2 text-sm text-muted">Only entries you marked as posted. The server never sent them.</p>
      {logs.length === 0 ? (
        <p className="mt-10 text-muted">Nothing confirmed yet.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {logs.map((row) => (
            <li key={row.id} className="rounded-lg border border-line p-4">
              <p className="text-xs uppercase tracking-widest text-faint">
                {row.network} · {formatClock(row.confirmedAt)}
              </p>
              <p className="mt-2 whitespace-pre-wrap">{row.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
