import { z } from "zod";

export const PRS_TYPE = "github.prs";
export const FAILING_ACTIONS_TYPE = "github.failingActions";
export const DEPENDABOT_TYPE = "github.dependabot";

// "owner/name" — interpolated into `gh api` paths, so reject anything with a
// path/query separator or whitespace.
const repoSchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Use owner/name");

// --- Config schemas (.describe() drives form labels) ---
export const prsConfigSchema = z.object({
  authors: z.array(z.string()).default([]).describe("GitHub usernames (blank = your PRs)"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max PRs"),
});
export type PrsConfig = z.infer<typeof prsConfigSchema>;
export const prsDefaultConfig: PrsConfig = { authors: [], limit: 20 };

export const failingActionsConfigSchema = z.object({
  repos: z.array(repoSchema).default([]).describe("Repos (owner/name)"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max runs"),
});
export type FailingActionsConfig = z.infer<typeof failingActionsConfigSchema>;
export const failingActionsDefaultConfig: FailingActionsConfig = { repos: [], limit: 10 };

export const dependabotConfigSchema = z.object({
  repos: z.array(repoSchema).default([]).describe("Repos (owner/name)"),
  severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Min severity"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max alerts"),
});
export type DependabotConfig = z.infer<typeof dependabotConfigSchema>;
export const dependabotDefaultConfig: DependabotConfig = { repos: [], limit: 10 };

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

export type PrsData = { prs: PrItem[] };
export type FailingActionsData = { runs: RunItem[]; errors?: string[] };
export type DependabotData = { alerts: AlertItem[]; errors?: string[] };
