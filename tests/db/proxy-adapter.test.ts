import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "../helpers/db";
import { getDb, schema } from "@/db/client";

beforeEach(() => useTempDb());

describe("sqlite-proxy adapter", () => {
  it("round-trips a row through insert + select().all()", async () => {
    await getDb().insert(schema.prefs).values({ key: "k", value: "v" });
    const rows = await getDb().select().from(schema.prefs);
    expect(rows).toEqual([{ key: "k", value: "v" }]);
  });

  it("select().get() returns the row on a hit", async () => {
    await getDb().insert(schema.prefs).values({ key: "k", value: "v" });
    const row = await getDb().select().from(schema.prefs).where(eq(schema.prefs.key, "k")).get();
    expect(row).toEqual({ key: "k", value: "v" });
  });

  it("select().get() returns undefined on a miss", async () => {
    const row = await getDb().select().from(schema.prefs).where(eq(schema.prefs.key, "nope")).get();
    expect(row).toBeUndefined();
  });

  it("decodes json columns and boolean columns", async () => {
    await getDb().insert(schema.widgets).values({
      id: "w1", type: "core.status", title: null, accent: null, order: 0, colSpan: 1, rowSpan: 6,
      hidden: true, config: { a: 1 },
    });
    const row = await getDb().select().from(schema.widgets).where(eq(schema.widgets.id, "w1")).get();
    expect(row!.hidden).toBe(true);
    expect(row!.config).toEqual({ a: 1 });
  });

  it("batch() runs multiple writes atomically", async () => {
    const db = getDb();
    // success path: both writes land
    await db.batch([
      db.insert(schema.prefs).values({ key: "a", value: "1" }),
      db.insert(schema.prefs).values({ key: "b", value: "2" }),
    ]);
    expect(await db.select().from(schema.prefs)).toHaveLength(2);
    // atomic path: a failing statement rolls the whole batch back
    await expect(
      db.batch([
        db.insert(schema.prefs).values({ key: "c", value: "3" }),
        db.insert(schema.prefs).values({ key: "a", value: "dup" }), // PK conflict → throws
      ]),
    ).rejects.toThrow();
    expect(await db.select().from(schema.prefs).where(eq(schema.prefs.key, "c")).get()).toBeUndefined();
    expect(await db.select().from(schema.prefs)).toHaveLength(2); // still just a, b
  });
});
