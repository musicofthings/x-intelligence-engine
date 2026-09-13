import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listLogs } from "@/lib/db/store";
import { snapshotFor } from "@/lib/session/engine";
import { formatMmSs } from "@/lib/utils";

export default async function StatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [logs, snap] = await Promise.all([listLogs(session.user.id), snapshotFor(session.user.id)]);
  const replies = logs.length;
  const live = snap.session?.liveMs ?? 0;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-4xl italic">Stats</h1>
      <dl className="mt-8 grid grid-cols-2 gap-6">
        <div>
          <dt className="text-xs uppercase tracking-widest text-faint">Replies logged</dt>
          <dd className="mt-1 tabular font-display text-4xl">{replies}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-faint">This round</dt>
          <dd className="mt-1 tabular font-display text-4xl">{formatMmSs(live)}</dd>
        </div>
      </dl>
      <div className="mt-12">
        <h2 className="font-display text-2xl italic">Followers</h2>
        <p className="mt-2 text-sm text-muted">No X analytics yet. Session days will mark this later.</p>
      </div>
    </div>
  );
}
