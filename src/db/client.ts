import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let db: BetterSQLite3Database<typeof schema> | null = null;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    const path = process.env.DASHBOARD_DB ?? "dashboard.db";
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    db = drizzle(sqlite, { schema });
  }
  return db;
}

// Test helper: point at a fresh db and reset the singleton.
export function __resetDbForTests() {
  db = null;
}

export { schema };
