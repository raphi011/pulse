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
    const data = await fetchDependabot({ repos: ["o/r", "o/r2"] });
    expect(data.alerts).toHaveLength(1);
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("/repos/o/r/dependabot/alerts");
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("state=open");
  });

  it("passes severity filter when set", async () => {
    mockJson.mockResolvedValueOnce([]);
    await fetchDependabot({ repos: ["o/r"], severity: "critical" });
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("severity=critical");
  });

  it("returns empty when no repos configured", async () => {
    await expect(fetchDependabot({ repos: [] })).resolves.toEqual({ alerts: [] });
  });
});
