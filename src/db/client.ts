import "server-only";
import Database from "better-sqlite3";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

let db: SqliteRemoteDatabase<typeof schema> | null = null;

/**
 * better-sqlite3 binds only numbers, strings, bigints, buffers, and null.
 * The proxy hands params through raw, so coerce JS booleans → 0/1 and
 * undefined → null defensively. (Drizzle usually pre-encodes these, but this
 * keeps the transport robust and is the single place that touches raw params.)
 */
function bind(params: unknown[]): unknown[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p === undefined ? null : p));
}

/**
 * Execute one statement against better-sqlite3, returning rows as
 * column-ordered arrays — the shape drizzle's sqlite-proxy expects.
 * For "get" misses, return the raw undefined row: sqlite-proxy's mapGetResult
 * treats a falsy `rows` as a miss (=> undefined), but an empty array as a hit
 * (=> a row of undefined columns), so we must NOT coerce to [] here.
 */
function exec(sqlite: Database.Database, sql: string, params: unknown[], method: string): { rows: unknown[] } {
  const stmt = sqlite.prepare(sql);
  if (method === "run") {
    stmt.run(...bind(params));
    return { rows: [] };
  }
  if (method === "get") {
    const row = stmt.raw().get(...bind(params)) as unknown[] | undefined;
    // undefined on a miss: sqlite-proxy's mapGetResult treats a falsy `rows` as a miss.
    // Typed as unknown[] (assignable to the proxy callback's any[]); the runtime undefined passes through.
    return { rows: row as unknown[] };
  }
  // "all" | "values"
  return { rows: stmt.raw().all(...bind(params)) as unknown[] };
}

export function getDb(): SqliteRemoteDatabase<typeof schema> {
  if (!db) {
    const path = process.env.DASHBOARD_DB ?? "dashboard.db";
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");

    db = drizzle(
      async (sql, params, method) => exec(sqlite, sql, params, method),
      async (queries) => {
        const runAll = sqlite.transaction(
          (qs: { sql: string; params: unknown[]; method: string }[]) =>
            qs.map((q) => exec(sqlite, q.sql, q.params, q.method)),
        );
        return runAll(queries);
      },
      { schema },
    );
  }
  return db;
}

// Test helper: point at a fresh db and reset the singleton.
export function __resetDbForTests() {
  db = null;
}

export { schema };
