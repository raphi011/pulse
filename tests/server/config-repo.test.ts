import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import * as repo from "@/server/config-repo";

beforeEach(() => useTempDb());

describe("config-repo", () => {
  it("adds widgets into the shortest column", () => {
    const a = repo.addWidget("core.status", { label: "A" });
    const b = repo.addWidget("core.status", { label: "B" });
    expect(a.column).toBe(0);
    expect(b.column).toBe(1); // spread across columns
    expect(repo.getWidgets()).toHaveLength(2);
  });

  it("persists positions", () => {
    const a = repo.addWidget("core.status", {});
    repo.setPositions([{ id: a.id, column: 2, order: 5 }]);
    expect(repo.getWidget(a.id)!.column).toBe(2);
    expect(repo.getWidget(a.id)!.order).toBe(5);
  });

  it("hides and removes widgets", () => {
    const a = repo.addWidget("core.status", {});
    repo.setHidden(a.id, true);
    expect(repo.getWidget(a.id)!.hidden).toBe(true);
    repo.removeWidget(a.id);
    expect(repo.getWidget(a.id)).toBeUndefined();
  });

  it("reads and writes prefs with defaults", () => {
    expect(repo.getPref("columnCount", "3")).toBe("3");
    repo.setPref("columnCount", "4");
    expect(repo.getPref("columnCount", "3")).toBe("4");
  });
});
