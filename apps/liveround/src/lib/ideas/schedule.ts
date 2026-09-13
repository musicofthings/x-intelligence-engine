import type { PostIdea, PostingSettings } from "@/lib/types";
import { clamp } from "@/lib/utils";

const JITTER_MS = 12 * 60_000;

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map((n) => Number(n));
  return { h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 };
}

function zonedParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; w: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
    w: weekdays.indexOf(parts.weekday ?? "Mon"),
  };
}

/** Approximate instant for a wall-clock in a timezone. */
export function zonedDate(timeZone: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = zonedParts(utcGuess, timeZone);
  const asUtc = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi);
  return utcGuess + (utcGuess - asUtc);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function normalizePosting(settings: PostingSettings): PostingSettings {
  return {
    ...settings,
    postsPerDay: clamp(Math.round(settings.postsPerDay) || 3, 1, 10),
    windowStart: /^\d{2}:\d{2}$/.test(settings.windowStart) ? settings.windowStart : "09:00",
    windowEnd: /^\d{2}:\d{2}$/.test(settings.windowEnd) ? settings.windowEnd : "17:00",
    timezone: settings.timezone || "America/New_York",
  };
}

export function slotsForDay(settings: PostingSettings, dayStartMs: number, seed: string): number[] {
  const s = normalizePosting(settings);
  const start = parseHm(s.windowStart);
  const end = parseHm(s.windowEnd);
  const parts = zonedParts(dayStartMs, s.timezone);
  const windowStart = zonedDate(s.timezone, parts.y, parts.mo, parts.d, start.h, start.m);
  let windowEnd = zonedDate(s.timezone, parts.y, parts.mo, parts.d, end.h, end.m);
  if (windowEnd <= windowStart) windowEnd += 24 * 60 * 60 * 1000;
  const span = windowEnd - windowStart;
  const slots: number[] = [];
  for (let i = 0; i < s.postsPerDay; i++) {
    const center = windowStart + ((i + 0.5) * span) / s.postsPerDay;
    const jitter = ((hash(`${seed}:${parts.y}-${parts.mo}-${parts.d}:${i}`) % (JITTER_MS * 2 + 1)) - JITTER_MS);
    slots.push(Math.min(windowEnd - 60_000, Math.max(windowStart, center + jitter)));
  }
  return slots.sort((a, b) => a - b);
}

export function nextSlot(settings: PostingSettings, occupied: string[], now = Date.now(), seed = "lr"): string {
  const taken = new Set(occupied.filter(Boolean).map((iso) => Math.round(Date.parse(iso) / 60_000)));
  for (let day = 0; day < 14; day++) {
    const dayMs = now + day * 24 * 60 * 60 * 1000;
    for (const slot of slotsForDay(settings, dayMs, seed)) {
      if (slot < now + 60_000) continue;
      const key = Math.round(slot / 60_000);
      if (taken.has(key)) continue;
      return new Date(slot).toISOString();
    }
  }
  return new Date(now + 60 * 60 * 1000).toISOString();
}

export function assignSlot(idea: PostIdea, settings: PostingSettings, occupied: string[], now = Date.now()): PostIdea {
  return {
    ...idea,
    status: "approved",
    scheduledAt: nextSlot(settings, occupied, now, idea.userId),
    failReason: null,
  };
}
