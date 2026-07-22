import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { __resetDbForTests } from "@/db/client";

export function useTempDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const path = join(dir, "test.db");
  const sqlite = new Database(path);
  migrate(drizzle(sqlite), { migrationsFolder: "drizzle" });
  sqlite.close();
  process.env.DASHBOARD_DB = path;
  __resetDbForTests();
}
