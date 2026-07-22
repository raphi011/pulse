import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { ghJson } from "@/modules/github/gh";
import { normalizeAlert, fetchDependabot, type GhAlert } from "@/modules/github/dependabot";

const mockJson = ghJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockJson.mockReset(); });

const rawAlert: GhAlert = {
  html_url: "https://github.com/o/r/security/dependabot/1",
  security_advisory: { summary: "RCE in foo", severity: "high" },
  security_vulnerability: { package: { name: "foo", ecosystem: "npm" } },
};

const alertOf = (severity: GhAlert["security_advisory"]["severity"], n: number): GhAlert => ({
  html_url: `https://github.com/o/r/security/dependabot/${n}`,
  security_advisory: { summary: `adv ${n}`, severity },
  security_vulnerability: { package: { name: `pkg${n}`, ecosystem: "npm" } },
});

describe("normalizeAlert", () => {
  it("maps a REST alert to AlertItem", () => {
    expect(normalizeAlert("o/r", rawAlert)).toEqual({
      repo: "o/r", package: "foo", severity: "high",
      summary: "RCE in foo", url: "https://github.com/o/r/security/dependabot/1",
    });
  });
});

describe("fetchDependabot", () => {
  it("queries open alerts per repo and merges", async () => {
    mockJson.mockResolvedValueOnce([rawAlert]).mockResolvedValueOnce([]);
    const data = await fetchDependabot({ repos: ["o/r", "o/r2"], limit: 10 });
    expect(data.alerts).toHaveLength(1);
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("/repos/o/r/dependabot/alerts");
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("state=open");
  });

  it("treats configured severity as a floor, keeping equal-or-higher alerts", async () => {
    // The REST severity param is exact-match, so we fetch all and filter client-side.
    mockJson.mockResolvedValueOnce([alertOf("low", 1), alertOf("high", 2), alertOf("critical", 3)]);
    const data = await fetchDependabot({ repos: ["o/r"], severity: "high", limit: 10 });
    expect(data.alerts.map((a) => a.severity).sort()).toEqual(["critical", "high"]);
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).not.toContain("severity=");
  });

  it("sorts merged alerts most-severe first (before the widget slices)", async () => {
    mockJson
      .mockResolvedValueOnce([alertOf("medium", 1), alertOf("critical", 2)])
      .mockResolvedValueOnce([alertOf("high", 3), alertOf("low", 4)]);
    const data = await fetchDependabot({ repos: ["o/a", "o/b"], limit: 10 });
    expect(data.alerts.map((a) => a.severity)).toEqual(["critical", "high", "medium", "low"]);
  });

  it("returns empty when no repos configured", async () => {
    await expect(fetchDependabot({ repos: [], limit: 10 })).resolves.toEqual({ alerts: [] });
  });

  it("keeps successful repos when one repo errors and reports the failed repo", async () => {
    mockJson.mockResolvedValueOnce([rawAlert]).mockRejectedValueOnce(new Error("boom"));
    const data = await fetchDependabot({ repos: ["o/r", "o/bad"], limit: 10 });
    expect(data.alerts).toHaveLength(1);
    expect(data.errors).toEqual(["o/bad"]);
  });

  it("throws when every repo errors", async () => {
    mockJson.mockRejectedValue(new Error("boom"));
    await expect(fetchDependabot({ repos: ["o/a", "o/b"], limit: 10 })).rejects.toThrow();
  });
});
