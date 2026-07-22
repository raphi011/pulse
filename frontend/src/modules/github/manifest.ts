export const PRS_TYPE = "github.prs";
export const FAILING_ACTIONS_TYPE = "github.failingActions";
export const DEPENDABOT_TYPE = "github.dependabot";

// Config shapes mirror the Go manifests (forms are generated server-side).
export interface PrsConfig {
  authors: string[];
  limit: number;
}
export interface FailingActionsConfig {
  repos: string[];
  limit: number;
}
export interface DependabotConfig {
  repos: string[];
  severity?: Severity;
  limit: number;
}

// --- Shared data shapes (payloads produced by internal/modules/github) ---
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
