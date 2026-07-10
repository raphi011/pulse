import { describe, it, expect } from "vitest";
import "@/modules/server";
import { getServerWidget } from "@/modules/server-registry";
import { BOOKMARKS_TYPE } from "@/modules/bookmarks/manifest";

describe("bookmarks server registration", () => {
  it("registers bookmarks.links on the server registry with defaults", () => {
    const def = getServerWidget(BOOKMARKS_TYPE);
    expect(def).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ bookmarks: [] });
    expect(typeof def!.fetch).toBe("function");
  });
});

import "@/modules/client";
import { getClientWidget } from "@/modules/client-registry";

describe("bookmarks client registration", () => {
  it("registers bookmarks.links on the client registry with title, schema, and seams", () => {
    const def = getClientWidget(BOOKMARKS_TYPE);
    expect(def).toBeDefined();
    expect(def!.title).toBe("Bookmarks");
    expect(def!.configSchema).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ bookmarks: [] });
    expect(def!.formEditable).toBe(false);
    expect(def!.HeaderControls).toBeDefined();
  });
});
