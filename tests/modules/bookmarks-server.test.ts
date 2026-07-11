import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { addBookmark } from "@/modules/bookmarks/repo";
import { fetchBookmarks } from "@/modules/bookmarks/fetch";
import { normalizeUrl } from "@/modules/bookmarks/manifest";

beforeEach(() => useTempDb());

describe("bookmarks fetch (reads the module table)", () => {
  it("returns an empty list on a fresh table", async () => {
    await expect(fetchBookmarks()).resolves.toEqual({ bookmarks: [] });
  });

  it("returns stored bookmarks as {id,title,url} in order", async () => {
    const a = await addBookmark("Acme", "https://example.com/");
    await addBookmark("GitHub", "https://github.com/");
    const data = await fetchBookmarks();
    expect(data.bookmarks).toEqual([
      { id: a.id, title: "Acme", url: "https://example.com/" },
      { id: data.bookmarks[1].id, title: "GitHub", url: "https://github.com/" },
    ]);
  });
});

describe("normalizeUrl", () => {
  it("prepends https:// when no scheme is present", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
  });

  it("keeps an existing http/https scheme", () => {
    expect(normalizeUrl("http://foo.com/bar")).toBe("http://foo.com/bar");
  });

  it("rejects blank input", () => {
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("rejects input that cannot form a URL", () => {
    expect(normalizeUrl("has spaces in it")).toBeNull();
  });
});
