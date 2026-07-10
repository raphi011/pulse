import "server-only";
import { ghJson } from "./gh";
import type { RunItem, FailingActionsData, FailingActionsConfig } from "./manifest";

export type GhRun = {
  displayTitle: string; workflowName: string; headBranch: string;
  event: string; url: string; createdAt: string;
};

const RUN_JSON = "displayTitle,workflowName,headBranch,event,url,createdAt";

export function normalizeRun(repo: string, raw: GhRun): RunItem {
  return {
    repo, name: raw.displayTitle, url: raw.url,
    branch: raw.headBranch, event: raw.event, createdAt: raw.createdAt,
  };
}

export async function fetchFailingActions(config: FailingActionsConfig): Promise<FailingActionsData> {
  if (config.repos.length === 0) return { runs: [] };
  const results = await Promise.allSettled(
    config.repos.map(async (repo) => {
      const raw = await ghJson<GhRun[]>([
        "run", "list", "-R", repo, "--status=failure",
        "--json", RUN_JSON, "--limit", String(config.limit),
      ]);
      return raw.map((r) => normalizeRun(repo, r));
    }),
  );
  if (results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  const runs = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const errors = config.repos.filter((_, i) => results[i].status === "rejected");
  return errors.length ? { runs, errors } : { runs };
}
