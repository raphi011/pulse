import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import * as cache from "@/server/cache-repo";

beforeEach(() => useTempDb());

describe("cache-repo", () => {
  it("returns undefined for a miss", () => {
    expect(cache.get("w1")).toBeUndefined();
  });

  it("upserts and reads back a payload with a timestamp", () => {
    const row = cache.set("w1", { status: "ok", payload: { n: 1 }, error: null });
    expect(row.status).toBe("ok");
    expect(row.payload).toEqual({ n: 1 });
    expect(row.fetchedAt).toBeGreaterThan(0);
    expect(cache.get("w1")!.payload).toEqual({ n: 1 });
  });

  it("overwrites on second set", () => {
    cache.set("w1", { status: "ok", payload: { n: 1 }, error: null });
    cache.set("w1", { status: "error", payload: { n: 1 }, error: "boom" });
    const row = cache.get("w1")!;
    expect(row.status).toBe("error");
    expect(row.error).toBe("boom");
  });

  it("persists and reads back errorKind on failure", () => {
    cache.set("w1", { status: "error", payload: null, error: "boom", errorKind: "auth" });
    expect(cache.get("w1")!.errorKind).toBe("auth");
  });

  it("defaults errorKind to null when omitted", () => {
    cache.set("w2", { status: "ok", payload: { n: 1 }, error: null });
    expect(cache.get("w2")!.errorKind).toBeNull();
  });
});
