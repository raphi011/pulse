import { describe, it, expect } from "vitest";
import { fetchBookmarks } from "@/modules/bookmarks/server";
import { normalizeUrl } from "@/modules/bookmarks/manifest";

describe("bookmarks fetch (identity)", () => {
  it("returns the config bookmarks unchanged", async () => {
    const bookmarks = [{ title: "Acme", url: "https://example.com/" }];
    await expect(fetchBookmarks({ bookmarks })).resolves.toEqual({ bookmarks });
  });

  it("returns an empty list for empty config", async () => {
    await expect(fetchBookmarks({ bookmarks: [] })).resolves.toEqual({ bookmarks: [] });
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
