import { z } from "zod";

export const MY_PRS_TYPE = "github.myPrs";
export const TEAM_PRS_TYPE = "github.teamPrs";
export const FAILING_ACTIONS_TYPE = "github.failingActions";
export const DEPENDABOT_TYPE = "github.dependabot";

// --- Config schemas (.describe() drives form labels) ---
export const myPrsConfigSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe("Max PRs"),
});
export type MyPrsConfig = z.infer<typeof myPrsConfigSchema>;
export const myPrsDefaultConfig: MyPrsConfig = { limit: 20 };

export const teamPrsConfigSchema = z.object({
  authors: z.array(z.string()).default([]).describe("GitHub usernames"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max PRs"),
});
export type TeamPrsConfig = z.infer<typeof teamPrsConfigSchema>;
export const teamPrsDefaultConfig: TeamPrsConfig = { authors: [], limit: 20 };

export const failingActionsConfigSchema = z.object({
  repos: z.array(z.string()).default([]).describe("Repos (owner/name)"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max runs per repo"),
});
export type FailingActionsConfig = z.infer<typeof failingActionsConfigSchema>;
export const failingActionsDefaultConfig: FailingActionsConfig = { repos: [], limit: 10 };

export const dependabotConfigSchema = z.object({
  repos: z.array(z.string()).default([]).describe("Repos (owner/name)"),
  severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Min severity"),
});
export type DependabotConfig = z.infer<typeof dependabotConfigSchema>;
export const dependabotDefaultConfig: DependabotConfig = { repos: [] };

// --- Shared data shapes ---
export type CiStatus = "ok" | "warn" | "danger" | "none";
export type Severity = "low" | "medium" | "high" | "critical";

export type PrItem = {
  repo: string; number: number; title: string; url: string;
  author: string; ci: CiStatus; review: string; updatedAt: string;
};
export type RunItem = {
  repo: string; name: string; url: string; branch: string; event: string; createdAt: string;
};
export type AlertItem = {
  repo: string; package: string; severity: Severity; summary: string; url: string;
};

export type MyPrsData = { prs: PrItem[] };
export type TeamPrsData = { prs: PrItem[] };
export type FailingActionsData = { runs: RunItem[] };
export type DependabotData = { alerts: AlertItem[] };
