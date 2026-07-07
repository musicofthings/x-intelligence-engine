export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "bg-slate-700 text-slate-300";
  if (score >= 90) return "bg-red-600/20 text-red-300 ring-1 ring-red-500/40";
  if (score >= 75) return "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40";
  if (score >= 60) return "bg-teal-500/20 text-teal-300 ring-1 ring-teal-500/40";
  return "bg-slate-700 text-slate-300";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
