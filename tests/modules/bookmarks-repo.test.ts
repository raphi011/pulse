import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { listBookmarks, addBookmark, removeBookmark } from "@/modules/bookmarks/repo";

beforeEach(() => useTempDb());

describe("bookmarks repo", () => {
  it("starts empty", async () => {
    expect(await listBookmarks()).toEqual([]);
  });

  it("adds bookmarks and lists them in insertion order", async () => {
    const a = await addBookmark("Acme", "https://example.com/");
    await addBookmark("GitHub", "https://github.com/");
    const rows = await listBookmarks();
    expect(rows.map((r) => r.title)).toEqual(["Acme", "GitHub"]);
    expect(rows[0].id).toBe(a.id);
    expect(rows[1].order).toBeGreaterThan(rows[0].order);
  });

  it("removes a bookmark by id", async () => {
    const a = await addBookmark("Acme", "https://example.com/");
    await addBookmark("GitHub", "https://github.com/");
    await removeBookmark(a.id);
    expect((await listBookmarks()).map((r) => r.title)).toEqual(["GitHub"]);
  });
});
