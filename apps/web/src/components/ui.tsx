import type { ReactNode } from "react";
import { scoreColor } from "../lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-800 bg-slate-900/60 p-4 ${className}`}>{children}</div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function ScoreBadge({ label, score }: { label: string; score: number | null | undefined }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${scoreColor(score)}`}>
      <span className="opacity-70">{label}</span>
      <span>{score ?? "—"}</span>
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 p-10 text-center">
      <div className="text-slate-300">{title}</div>
      {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="p-8 text-center text-sm text-slate-400" role="status">{label}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300" role="alert">
      {message}
    </div>
  );
}

export function Button({
  children, onClick, variant = "default", type = "button", disabled,
}: {
  children: ReactNode; onClick?: () => void; variant?: "default" | "primary" | "danger"; type?: "button" | "submit"; disabled?: boolean;
}) {
  const styles = {
    default: "bg-slate-800 hover:bg-slate-700 text-slate-200",
    primary: "bg-sky-600 hover:bg-sky-500 text-white",
    danger: "bg-red-700 hover:bg-red-600 text-white",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles}`}>
      {children}
    </button>
  );
}
