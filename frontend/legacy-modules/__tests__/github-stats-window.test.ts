import { describe, it, expect } from "vitest";
import { windowFor, yearWindow, CONTRIB_QUERY } from "@/modules/github-stats/stats";

const NOW = new Date("2026-07-12T10:00:00.000Z");
const DAY_MS = 86_400_000;

describe("windowFor", () => {
  it("7d subtracts 7 days from now, to = now", () => {
    expect(windowFor("7d", NOW)).toEqual({
      from: "2026-07-05T10:00:00.000Z",
      to: "2026-07-12T10:00:00.000Z",
    });
  });

  it("30d subtracts 30 days", () => {
    expect(windowFor("30d", NOW).from).toBe("2026-06-12T10:00:00.000Z");
  });

  it("90d spans exactly 90 days", () => {
    const { from, to } = windowFor("90d", NOW);
    expect(Date.parse(to) - Date.parse(from)).toBe(90 * DAY_MS);
  });

  it("year starts at Jan 1 of now's UTC year", () => {
    expect(windowFor("year", NOW)).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-07-12T10:00:00.000Z",
    });
  });
});

describe("yearWindow", () => {
  it("is the trailing 12 months", () => {
    expect(yearWindow(NOW)).toEqual({
      from: "2025-07-12T10:00:00.000Z",
      to: "2026-07-12T10:00:00.000Z",
    });
  });
});

describe("CONTRIB_QUERY", () => {
  it("queries the viewer's contributionsCollection with a date-typed window", () => {
    expect(CONTRIB_QUERY).toContain("contributionsCollection(from: $from, to: $to)");
    expect(CONTRIB_QUERY).toContain("$from: DateTime!");
    expect(CONTRIB_QUERY).toContain("contributionLevel");
  });
});
