import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

let db: SqliteRemoteDatabase<typeof schema> | null = null;

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Transport = {
  query: (sql: string, params: unknown[], method: string) => Promise<{ rows: unknown[] }>;
  batch: (queries: { sql: string; params: unknown[]; method: string }[]) => Promise<{ rows: unknown[] }[]>;
};

/**
 * Tauri webview transport: talks to the SQL plugin (Rust side owns the sqlite
 * connection). `select` returns rows as objects; drizzle's sqlite-proxy expects
 * column-ordered arrays, so we map via `Object.values` (assumes the plugin
 * preserves SELECT column order — validated live in Task 9).
 */
function makeTauriTransport(): Transport {
  // Lazy singleton: Database.load is async; load once, reuse.
  let loading: Promise<import("@tauri-apps/plugin-sql").default> | null = null;
  const load = async () => {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    return (loading ??= Database.load("sqlite:dashboard.db"));
  };
  const query = async (sql: string, params: unknown[], method: string): Promise<{ rows: unknown[] }> => {
    const sqlDb = await load();
    if (method === "run") {
      await sqlDb.execute(sql, params);
      return { rows: [] };
    }
    const objRows = await sqlDb.select<Record<string, unknown>[]>(sql, params);
    const arr = objRows.map((r) => Object.values(r)); // object → column-ordered array (SQLite returns select-order keys)
    // undefined on a miss: sqlite-proxy's mapGetResult treats a falsy `rows` as a miss.
    if (method === "get") return { rows: arr[0] as unknown[] };
    return { rows: arr };
  };
  return {
    query,
    batch: async (queries: { sql: string; params: unknown[]; method: string }[]) => {
      const sqlDb = await load();
      // tauri-plugin-sql has no multi-statement transaction API from JS; emulate atomicity with BEGIN/COMMIT.
      await sqlDb.execute("BEGIN", []);
      try {
        const out: { rows: unknown[] }[] = [];
        for (const q of queries) out.push(await query(q.sql, q.params, q.method));
        await sqlDb.execute("COMMIT", []);
        return out;
      } catch (e) {
        await sqlDb.execute("ROLLBACK", []);
        throw e;
      }
    },
  };
}

/**
 * Node/test transport: better-sqlite3, dynamically imported so bundlers
 * targeting the webview never pull it in.
 *
 * better-sqlite3 binds only numbers, strings, bigints, buffers, and null.
 * The proxy hands params through raw, so coerce JS booleans → 0/1 and
 * undefined → null defensively. (Drizzle usually pre-encodes these, but this
 * keeps the transport robust and is the single place that touches raw params.)
 *
 * Rows come back via `.raw()` — column-ordered arrays, the shape drizzle's
 * sqlite-proxy expects. For "get" misses, return the raw undefined row:
 * sqlite-proxy's mapGetResult treats a falsy `rows` as a miss (=> undefined),
 * but an empty array as a hit (=> a row of undefined columns), so we must
 * NOT coerce to [] here.
 */
async function makeNodeTransport(): Promise<Transport> {
  const { default: Database } = await import("better-sqlite3");
  const path = process.env.DASHBOARD_DB ?? "dashboard.db";
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const bind = (params: unknown[]) =>
    params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p === undefined ? null : p));
  const exec = (sql: string, params: unknown[], method: string): { rows: unknown[] } => {
    const stmt = sqlite.prepare(sql);
    if (method === "run") {
      stmt.run(...bind(params));
      return { rows: [] };
    }
    if (method === "get") {
      // undefined on a miss: sqlite-proxy's mapGetResult treats a falsy `rows` as a miss.
      return { rows: stmt.raw().get(...bind(params)) as unknown[] };
    }
    return { rows: stmt.raw().all(...bind(params)) as unknown[] };
  };
  return {
    query: async (sql: string, params: unknown[], method: string) => exec(sql, params, method),
    batch: async (queries: { sql: string; params: unknown[]; method: string }[]) => {
      const run = sqlite.transaction((qs: typeof queries) => qs.map((q) => exec(q.sql, q.params, q.method)));
      return run(queries);
    },
  };
}

let transport: Promise<Transport> | null = null;
function getTransport(): Promise<Transport> {
  return (transport ??= isTauri ? Promise.resolve(makeTauriTransport()) : makeNodeTransport());
}

export function getDb(): SqliteRemoteDatabase<typeof schema> {
  if (!db) {
    db = drizzle(
      async (sql, params, method) => (await getTransport()).query(sql, params, method),
      async (queries) => (await getTransport()).batch(queries),
      { schema },
    );
  }
  return db;
}

// Test helper: point at a fresh db and reset the singletons.
export function __resetDbForTests() {
  db = null;
  transport = null;
}

export { schema };
