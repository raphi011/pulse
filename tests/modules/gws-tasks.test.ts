import { describe, it, expect } from "vitest";
import { normalizeTask } from "@/modules/gws/tasks";

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
});
