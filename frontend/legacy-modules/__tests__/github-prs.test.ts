import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { ghJson } from "@/modules/github/gh";
import { rollupCi, normalizeSearchPr, fetchPrs, type GhSearchPr } from "@/modules/github/prs";
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

describe("fetchPrs", () => {
  it("defaults to your own PRs (--author=@me) when authors are blank", async () => {
    mockJson
      .mockResolvedValueOnce([rawPr]) // search
      .mockResolvedValueOnce({ statusCheckRollup: [{ conclusion: "FAILURE" }], reviewDecision: "APPROVED" }); // enrich
    const data = await fetchPrs({ authors: [], limit: 20 });
    expect(data.prs).toHaveLength(1);
    expect(data.prs[0].ci).toBe("danger");
    expect(data.prs[0].review).toBe("APPROVED");
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("--author=@me");
  });

  it("returns empty prs when search finds nothing", async () => {
    mockJson.mockResolvedValueOnce([]);
    await expect(fetchPrs({ authors: [], limit: 20 })).resolves.toEqual({ prs: [] });
  });

  it("degrades a failed enrichment to its normalized base", async () => {
    const second: GhSearchPr = { ...rawPr, number: 8, url: "https://github.com/o/r/pull/8" };
    mockJson
      .mockResolvedValueOnce([rawPr, second]) // search
      .mockResolvedValueOnce({ statusCheckRollup: [{ conclusion: "FAILURE" }], reviewDecision: "APPROVED" }) // enrich #1
      .mockRejectedValueOnce(new Error("gh pr view failed")); // enrich #2
    const data = await fetchPrs({ authors: [], limit: 20 });
    expect(data.prs).toHaveLength(2);
    expect(data.prs[0].ci).toBe("danger");
    expect(data.prs[1].ci).toBe("none");
    expect(data.prs[1].review).toBe("none");
  });

  // gh's `search prs --author` is single-valued (last wins), so multiple
  // authors must be split into one search each and merged.
  function mockByAuthor(prsByAuthor: Record<string, GhSearchPr[]>) {
    mockJson.mockImplementation((args: string[]) => {
      if (args[0] === "search") {
        const author = args.find((a) => a.startsWith("--author="))!.slice("--author=".length);
        return Promise.resolve(prsByAuthor[author] ?? []);
      }
      return Promise.resolve({ statusCheckRollup: [{ conclusion: "SUCCESS" }], reviewDecision: "APPROVED" });
    });
  }

  const searchCalls = () =>
    mockJson.mock.calls.map((c) => c[0] as string[]).filter((a) => a[0] === "search");

  it("issues one search per author, never multiple --author in one call", async () => {
    const alicePr: GhSearchPr = { ...rawPr, number: 1, url: "https://github.com/o/r/pull/1", author: { login: "alice" } };
    const bobPr: GhSearchPr = { ...rawPr, number: 2, url: "https://github.com/o/r/pull/2", author: { login: "bob" } };
    mockByAuthor({ alice: [alicePr], bob: [bobPr] });

    const data = await fetchPrs({ authors: ["alice", "bob"], limit: 20 });

    const searches = searchCalls();
    expect(searches).toHaveLength(2);
    for (const args of searches) {
      expect(args.filter((a) => a.startsWith("--author="))).toHaveLength(1);
    }
    expect(searches.map((a) => a.find((x) => x.startsWith("--author=")))).toEqual([
      "--author=alice",
      "--author=bob",
    ]);
    expect(data.prs.map((p) => p.author).sort()).toEqual(["alice", "bob"]);
  });

  it("merges results across authors, sorts by updatedAt desc, and caps to limit", async () => {
    const older: GhSearchPr = { ...rawPr, number: 1, url: "https://github.com/o/r/pull/1", author: { login: "alice" }, updatedAt: "2026-07-01T00:00:00Z" };
    const newer: GhSearchPr = { ...rawPr, number: 2, url: "https://github.com/o/r/pull/2", author: { login: "bob" }, updatedAt: "2026-07-09T00:00:00Z" };
    mockByAuthor({ alice: [older], bob: [newer] });

    const data = await fetchPrs({ authors: ["alice", "bob"], limit: 1 });

    expect(data.prs).toHaveLength(1);
    expect(data.prs[0].author).toBe("bob"); // most recently updated survives the cap
  });

  it("tolerates a single author's search failing but surfaces a total failure", async () => {
    mockJson.mockImplementation((args: string[]) => {
      if (args[0] === "search") {
        const author = args.find((a) => a.startsWith("--author="))!.slice("--author=".length);
        if (author === "bob") return Promise.reject(new Error("gh search failed"));
        return Promise.resolve([{ ...rawPr, author: { login: "alice" } }]);
      }
      return Promise.resolve({ statusCheckRollup: [{ conclusion: "SUCCESS" }], reviewDecision: "APPROVED" });
    });
    const data = await fetchPrs({ authors: ["alice", "bob"], limit: 20 });
    expect(data.prs.map((p) => p.author)).toEqual(["alice"]);

    mockJson.mockReset();
    mockJson.mockRejectedValue(new Error("gh auth failed"));
    await expect(fetchPrs({ authors: ["alice", "bob"], limit: 20 })).rejects.toThrow("gh auth failed");
  });
});
