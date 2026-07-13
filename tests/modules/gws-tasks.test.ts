import { describe, it, expect } from "vitest";
import { normalizeTask } from "@/modules/gws/tasks";
import { filterTasksByAge, sortTasks, type TaskItem } from "@/modules/gws/manifest";

describe("normalizeTask", () => {
  it("maps a pending task with notes and a due date", () => {
    const t = normalizeTask({
      id: "t1",
      title: "egress control repo-c",
      notes: "https://github.com/acme/deployments/pull/6048",
      status: "needsAction",
      due: "2026-07-15T00:00:00.000Z",
      webViewLink: "https://tasks.google.com/task/abc?sa=6",
    });
    expect(t).toMatchObject({
      id: "t1",
      title: "egress control repo-c",
      notes: "https://github.com/acme/deployments/pull/6048",
      due: "2026-07-15T00:00:00.000Z",
      completed: false,
      url: "https://tasks.google.com/task/abc?sa=6",
    });
  });

  it("flags completed tasks and fills empty due / title fallback", () => {
    const t = normalizeTask({ id: "t2", status: "completed", webViewLink: "" });
    expect(t).toMatchObject({ title: "(no title)", due: "", completed: true, url: "" });
    expect(t.notes).toBeUndefined();
  });

  it("captures the completion timestamp on completed tasks", () => {
    const t = normalizeTask({
      id: "t3",
      title: "shipped",
      status: "completed",
      completed: "2026-07-13T09:30:00.000Z",
      webViewLink: "https://tasks.google.com/task/xyz",
    });
    expect(t.completed).toBe(true);
    expect(t.completedAt).toBe("2026-07-13T09:30:00.000Z");
  });

  it("leaves completedAt empty when there is no timestamp", () => {
    expect(normalizeTask({ id: "t4", status: "needsAction" }).completedAt).toBe("");
  });
});

const mk = (id: string, completed: boolean, completedAt = ""): TaskItem => ({
  id, title: id, due: "", completed, completedAt, url: "",
});

describe("sortTasks", () => {
  it("puts incomplete tasks first and completed last, stable within each group", () => {
    const out = sortTasks([mk("a", true), mk("b", false), mk("c", true), mk("d", false)]);
    expect(out.map((t) => t.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("filterTasksByAge", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const tasks = [
    mk("todo", false),
    mk("earlierToday", true, "2026-07-13T08:00:00.000Z"),
    mk("threeDaysAgo", true, "2026-07-10T12:00:00.000Z"),
    mk("longAgo", true, "2026-05-01T12:00:00.000Z"),
    mk("noStamp", true, ""),
  ];

  it("keeps everything for All time", () => {
    expect(filterTasksByAge(tasks, "All time", now).map((t) => t.id)).toEqual(
      ["todo", "earlierToday", "threeDaysAgo", "longAgo", "noStamp"],
    );
  });

  it("Today keeps only completions since local midnight (plus incomplete and unstamped)", () => {
    // Note: uses local midnight; assert membership, not order, to stay timezone-robust.
    const ids = filterTasksByAge(tasks, "Today", now).map((t) => t.id);
    expect(ids).toContain("todo");
    expect(ids).toContain("noStamp");
    expect(ids).not.toContain("threeDaysAgo");
    expect(ids).not.toContain("longAgo");
  });

  it("Last 7 days drops completions older than the rolling window", () => {
    const ids = filterTasksByAge(tasks, "Last 7 days", now).map((t) => t.id);
    expect(ids).toEqual(["todo", "earlierToday", "threeDaysAgo", "noStamp"]);
  });

  it("Last 30 days keeps the three-day-old one but drops the two-month-old one", () => {
    const ids = filterTasksByAge(tasks, "Last 30 days", now).map((t) => t.id);
    expect(ids).not.toContain("longAgo");
    expect(ids).toContain("threeDaysAgo");
  });
});
