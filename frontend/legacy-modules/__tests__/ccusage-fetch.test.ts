import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/ccusage/ccusage", () => ({ runCcusage: vi.fn() }));
import { runCcusage } from "@/modules/ccusage/ccusage";
import { fetchCcusage } from "@/modules/ccusage/fetch";

const mockRun = runCcusage as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockRun.mockReset(); });

const cfg = { dailyLimitUsd: 20 };

describe("fetchCcusage", () => {
  it("parses today's totalCost and queries a single day", async () => {
    mockRun.mockResolvedValueOnce({ stdout: JSON.stringify({ totals: { totalCost: 2.65 } }), stderr: "" });
    const data = await fetchCcusage(cfg);
    expect(data.costUsd).toBe(2.65);

    const args = mockRun.mock.calls[0][0] as string[];
    expect(args[0]).toBe("daily");
    expect(args).toContain("--json");
    const since = args[args.indexOf("--since") + 1];
    const until = args[args.indexOf("--until") + 1];
    expect(since).toMatch(/^\d{8}$/);
    expect(until).toBe(since); // single day
    // date field mirrors the queried day
    expect(data.date).toBe(`${since.slice(0, 4)}-${since.slice(4, 6)}-${since.slice(6, 8)}`);
  });

  it("returns 0 when ccusage reports no usage for today", async () => {
    mockRun.mockResolvedValueOnce({ stdout: JSON.stringify({ daily: [] }), stderr: "" });
    const data = await fetchCcusage(cfg);
    expect(data.costUsd).toBe(0);
  });

  it("throws a classified CliError (not a raw SyntaxError) on non-JSON output", async () => {
    mockRun.mockResolvedValueOnce({ stdout: "npm warn ...\n{not json", stderr: "" });
    await expect(fetchCcusage(cfg)).rejects.toMatchObject({ kind: "failed" });
  });
});
