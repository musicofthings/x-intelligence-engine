import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { D1Like, D1PreparedStatementLike, D1Result } from "../src/d1.js";

// node:sqlite is a new (Node >=22.5) builtin that Vite's bundled builtins list does
// not yet recognize; load it via createRequire so the bundler leaves it alone.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = InstanceType<typeof DatabaseSync>;

/**
 * node:sqlite adapter implementing the D1Like interface, so the repository layer
 * (written against D1) can be integration-tested locally with zero native builds.
 * node:sqlite ships with Node >= 22.5 / stable in 24.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

function coerce(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

class Stmt implements D1PreparedStatementLike {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatementLike {
    this.values = values.map(coerce);
    return this;
  }
  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.values as never[])) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (colName ? (row[colName] as T) : (row as T)) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...(this.values as never[])) as T[];
    return { results: rows, success: true };
  }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const info = this.db.prepare(this.sql).run(...(this.values as never[]));
    return {
      results: [],
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

export class SqliteD1 implements D1Like {
  constructor(private readonly db: DatabaseSync) {}
  prepare(query: string): D1PreparedStatementLike {
    return new Stmt(this.db, query);
  }
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<D1Result<T>[]> {
    const out: D1Result<T>[] = [];
    for (const s of statements) out.push(await s.run<T>());
    return out;
  }
}

export function createTestDb(): { d1: SqliteD1; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    raw.exec(readFileSync(join(migrationsDir, f), "utf8"));
  }
  return { d1: new SqliteD1(raw), raw };
}
