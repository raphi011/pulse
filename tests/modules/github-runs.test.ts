import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { ghJson } from "@/modules/github/gh";
import { normalizeRun, fetchFailingActions, type GhRun } from "@/modules/github/runs";

const mockJson = ghJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockJson.mockReset(); });

const rawRun: GhRun = {
  displayTitle: "CI on main", workflowName: "CI", headBranch: "main",
  event: "push", url: "https://github.com/o/r/actions/runs/1", createdAt: "2026-07-08T09:00:00Z",
};

describe("normalizeRun", () => {
  it("maps a gh run to RunItem", () => {
    expect(normalizeRun("o/r", rawRun)).toEqual({
      repo: "o/r", name: "CI on main", url: "https://github.com/o/r/actions/runs/1",
      branch: "main", event: "push", createdAt: "2026-07-08T09:00:00Z",
    });
  });
});

describe("fetchFailingActions", () => {
  it("queries each repo with --status=failure and merges runs", async () => {
    mockJson.mockResolvedValueOnce([rawRun]).mockResolvedValueOnce([]);
    const data = await fetchFailingActions({ repos: ["o/r", "o/r2"], limit: 10 });
    expect(data.runs).toHaveLength(1);
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("--status=failure");
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("-R o/r");
  });

  it("keeps successful repos when one repo errors and reports the failed repo", async () => {
    mockJson.mockResolvedValueOnce([rawRun]).mockRejectedValueOnce(new Error("boom"));
    const data = await fetchFailingActions({ repos: ["o/r", "o/bad"], limit: 10 });
    expect(data.runs).toHaveLength(1);
    expect(data.errors).toEqual(["o/bad"]);
  });

  it("omits errors when every repo succeeds", async () => {
    mockJson.mockResolvedValueOnce([rawRun]).mockResolvedValueOnce([]);
    const data = await fetchFailingActions({ repos: ["o/r", "o/r2"], limit: 10 });
    expect(data.errors).toBeUndefined();
  });

  it("returns empty when no repos configured", async () => {
    await expect(fetchFailingActions({ repos: [], limit: 10 })).resolves.toEqual({ runs: [] });
  });

  it("throws when every repo errors", async () => {
    mockJson.mockRejectedValue(new Error("boom"));
    await expect(fetchFailingActions({ repos: ["o/a", "o/b"], limit: 10 })).rejects.toThrow();
  });
});
