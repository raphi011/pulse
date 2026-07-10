import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import * as repo from "@/server/config-repo";

beforeEach(() => useTempDb());

describe("config-repo", () => {
  it("appends widgets in order", () => {
    const a = repo.addWidget("core.status", { label: "A" });
    const b = repo.addWidget("core.status", { label: "B" });
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(repo.getWidgets()).toHaveLength(2);
  });

  it("persists positions", () => {
    const a = repo.addWidget("core.status", {});
    repo.setPositions([{ id: a.id, order: 5, colSpan: 3, rowSpan: 8 }]);
    const got = repo.getWidget(a.id)!;
    expect(got.order).toBe(5);
    expect(got.colSpan).toBe(3);
    expect(got.rowSpan).toBe(8);
  });

  it("hides and removes widgets", () => {
    const a = repo.addWidget("core.status", {});
    repo.setHidden(a.id, true);
    expect(repo.getWidget(a.id)!.hidden).toBe(true);
    repo.removeWidget(a.id);
    expect(repo.getWidget(a.id)).toBeUndefined();
  });

  it("reads and writes prefs with defaults", () => {
    expect(repo.getPref("theme", "dark")).toBe("dark");
    repo.setPref("theme", "light");
    expect(repo.getPref("theme", "dark")).toBe("light");
  });
});
