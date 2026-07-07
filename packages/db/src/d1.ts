/**
 * Minimal structural interface for Cloudflare D1, so repositories are testable
 * against any adapter (real D1 in Workers, better-sqlite3 in tests). This mirrors the
 * subset of the D1 API the repositories use.
 */

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Like {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<D1Result<T>[]>;
}

/** Clock + id source injected for deterministic tests. */
export interface Clock {
  nowIso(): string;
}

export interface IdGen {
  next(prefix: string): string;
}

export const systemClock: Clock = { nowIso: () => new Date().toISOString() };

export function randomIdGen(): IdGen {
  return {
    next(prefix) {
      const rand = crypto.getRandomValues(new Uint8Array(12));
      const hex = Array.from(rand)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `${prefix}_${hex}`;
    },
  };
}

export const bool = (v: unknown): boolean => v === 1 || v === true || v === "1";
export const intOf = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
export const jsonParse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || v === "") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
