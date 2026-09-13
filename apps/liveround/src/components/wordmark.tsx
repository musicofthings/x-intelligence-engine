import { cn } from "@/lib/utils";

export function Wordmark({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <LiveMark className={markClassName} />
      <span className="font-display italic tracking-tight">LiveRound</span>
    </span>
  );
}

export function LiveMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5", className)} aria-hidden>
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}
