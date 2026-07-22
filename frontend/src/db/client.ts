import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { invoke } from "@tauri-apps/api/core";
import * as schema from "./schema";

let db: SqliteRemoteDatabase<typeof schema> | null = null;

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Connection string for the SQL plugin. MUST stay in sync with DB_URL in src-tauri/src/db_batch.rs,
// which reaches for the same pool by this key.
const DB_URL = "sqlite:dashboard.db";

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
    // WAL parity with the Node transport; runs exactly once on first load.
    return (loading ??= Database.load(DB_URL).then(async (sqlDb) => {
      await sqlDb.execute("PRAGMA journal_mode=WAL", []);
      return sqlDb;
    }));
  };
  const query = async (sql: string, params: unknown[], method: string): Promise<{ rows: unknown[] }> => {
    const sqlDb = await load();
    if (method === "run") {
      await sqlDb.execute(sql, params);
      return { rows: [] };
    }
    const objRows = await sqlDb.select<Record<string, unknown>[]>(sql, params);
    // object → column-ordered array (SQLite returns select-order keys). NOTE: if a
    // query ever selects two columns with the same/aliased name, the duplicate key
    // collapses and Object.values silently drops a column. No current query does this.
    const arr = objRows.map((r) => Object.values(r));
    // undefined on a miss: sqlite-proxy's mapGetResult treats a falsy `rows` as a miss.
    if (method === "get") return { rows: arr[0] as unknown[] };
    return { rows: arr };
  };
  return {
    query,
    batch: async (queries: { sql: string; params: unknown[]; method: string }[]) => {
      // Real atomicity: the `db_batch` Rust command runs every statement inside ONE
      // held sqlx transaction. (Separate BEGIN/COMMIT IPC calls would race across
      // pooled connections and lose atomicity — that's the bug this replaces.)
      // Our batches are write-only; a batched select is unsupported by db_batch and
      // must fail loudly, not silently return [].
      const bad = queries.find((q) => q.method !== "run");
      if (bad) throw new Error(`db_batch supports only write ("run") statements; got method "${bad.method}"`);
      // db_batch reaches into the SQL plugin's pool by DB_URL — ensure Database.load() has registered
      // it first. Query paths call load() implicitly, but a batch-first path would otherwise fail
      // "pool not loaded".
      await load();
      await invoke("db_batch", { statements: queries.map((q) => ({ sql: q.sql, params: q.params })) });
      return queries.map(() => ({ rows: [] as unknown[] })); // drizzle batch expects one result per query
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
