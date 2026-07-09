import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { ghJson } from "@/modules/github/gh";
import { rollupCi, normalizeSearchPr, fetchMyPrs, fetchTeamPrs, type GhSearchPr } from "@/modules/github/prs";
import prView from "../fixtures/github/pr-view.json";
import searchPrs from "../fixtures/github/search-prs.json";

const mockJson = ghJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockJson.mockReset(); });

const rawPr: GhSearchPr = {
  number: 7, title: "Fix thing", url: "https://github.com/o/r/pull/7",
  repository: { nameWithOwner: "o/r" }, author: { login: "alice" },
  updatedAt: "2026-07-08T10:00:00Z",
};

describe("rollupCi", () => {
  it("returns none for empty checks", () => expect(rollupCi([])).toBe("none"));
  it("returns danger when any check failed", () =>
    expect(rollupCi([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }])).toBe("danger"));
  it("returns warn when a check is pending and none failed", () =>
    expect(rollupCi([{ status: "IN_PROGRESS" }, { conclusion: "SUCCESS" }])).toBe("warn"));
  it("returns warn for an expected-but-unreported check", () =>
    expect(rollupCi([{ state: "EXPECTED" }, { conclusion: "SUCCESS" }])).toBe("warn"));
  it("returns ok when all succeed", () =>
    expect(rollupCi([{ conclusion: "SUCCESS" }])).toBe("ok"));
  it("handles StatusContext state shape", () =>
    expect(rollupCi([{ state: "FAILURE" }])).toBe("danger"));
  it("rolls up the recorded pr-view fixture to danger", () =>
    expect(rollupCi(prView.statusCheckRollup)).toBe("danger"));
});

describe("normalizeSearchPr", () => {
  it("maps gh fields to PrItem with unknown ci/review", () => {
    expect(normalizeSearchPr(rawPr)).toEqual({
      repo: "o/r", number: 7, title: "Fix thing", url: "https://github.com/o/r/pull/7",
      author: "alice", ci: "none", review: "none", updatedAt: "2026-07-08T10:00:00Z",
    });
  });

  it("maps the recorded search-prs fixture", () => {
    const first = searchPrs[0] as GhSearchPr;
    const item = normalizeSearchPr(first);
    expect(item.repo).toBe(first.repository.nameWithOwner);
    expect(item.author).toBe(first.author.login);
    expect(item.number).toBe(first.number);
  });
});

describe("fetchMyPrs", () => {
  it("searches then enriches each PR with CI + review", async () => {
    mockJson
      .mockResolvedValueOnce([rawPr]) // search
      .mockResolvedValueOnce({ statusCheckRollup: [{ conclusion: "FAILURE" }], reviewDecision: "APPROVED" }); // enrich
    const data = await fetchMyPrs({ limit: 20 });
    expect(data.prs).toHaveLength(1);
    expect(data.prs[0].ci).toBe("danger");
    expect(data.prs[0].review).toBe("APPROVED");
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("--author=@me");
  });

  it("returns empty prs when search finds nothing", async () => {
    mockJson.mockResolvedValueOnce([]);
    await expect(fetchMyPrs({ limit: 20 })).resolves.toEqual({ prs: [] });
  });

  it("degrades a failed enrichment to its normalized base", async () => {
    const second: GhSearchPr = { ...rawPr, number: 8, url: "https://github.com/o/r/pull/8" };
    mockJson
      .mockResolvedValueOnce([rawPr, second]) // search
      .mockResolvedValueOnce({ statusCheckRollup: [{ conclusion: "FAILURE" }], reviewDecision: "APPROVED" }) // enrich #1
      .mockRejectedValueOnce(new Error("gh pr view failed")); // enrich #2
    const data = await fetchMyPrs({ limit: 20 });
    expect(data.prs).toHaveLength(2);
    expect(data.prs[0].ci).toBe("danger");
    expect(data.prs[1].ci).toBe("none");
    expect(data.prs[1].review).toBe("none");
  });
});

describe("fetchTeamPrs", () => {
  it("returns empty prs without calling gh when no authors", async () => {
    await expect(fetchTeamPrs({ authors: [], limit: 20 })).resolves.toEqual({ prs: [] });
    expect(mockJson).not.toHaveBeenCalled();
  });

  it("builds a search call with one --author arg per author", async () => {
    mockJson
      .mockResolvedValueOnce([rawPr]) // search
      .mockResolvedValueOnce({ statusCheckRollup: [{ conclusion: "SUCCESS" }], reviewDecision: "APPROVED" }); // enrich
    await fetchTeamPrs({ authors: ["alice", "bob"], limit: 20 });
    const args = (mockJson.mock.calls[0][0] as string[]).join(" ");
    expect(args).toContain("--author=alice");
    expect(args).toContain("--author=bob");
  });
});
