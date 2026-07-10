import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import { getFetchWidget } from "@/modules/fetch-registry";
import { BOOKMARKS_TYPE } from "@/modules/bookmarks/manifest";

describe("bookmarks server registration", () => {
  it("registers bookmarks.links on the server registry with defaults", () => {
    const def = getFetchWidget(BOOKMARKS_TYPE);
    expect(def).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ bookmarks: [] });
    expect(typeof def!.fetch).toBe("function");
  });
});

import "@/modules/render";
import { getRenderWidget } from "@/modules/render-registry";

describe("bookmarks client registration", () => {
  it("registers bookmarks.links on the client registry with title, schema, and seams", () => {
    const def = getRenderWidget(BOOKMARKS_TYPE);
    expect(def).toBeDefined();
    expect(def!.title).toBe("Bookmarks");
    expect(def!.configSchema).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ bookmarks: [] });
    expect(def!.formEditable).toBe(false);
    expect(def!.HeaderControls).toBeDefined();
  });
});
