import "server-only";
import { ghJson } from "./gh";
import type { CiStatus, PrItem, MyPrsData, TeamPrsData, MyPrsConfig, TeamPrsConfig } from "./manifest";

export type GhSearchPr = {
  number: number; title: string; url: string;
  repository: { nameWithOwner: string };
  author: { login: string };
  updatedAt: string; isDraft: boolean;
};

type GhCheck = { status?: string; conclusion?: string; state?: string };
type GhPrView = { statusCheckRollup?: GhCheck[]; reviewDecision?: string };

const FAIL = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const PENDING = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED"]);

export function rollupCi(checks: GhCheck[] | undefined): CiStatus {
  if (!checks || checks.length === 0) return "none";
  let sawPending = false;
  for (const c of checks) {
    const signal = c.conclusion || c.state || c.status || "";
    if (FAIL.has(signal)) return "danger";
    if (PENDING.has(signal) || (!c.conclusion && !c.state)) sawPending = true;
  }
  return sawPending ? "warn" : "ok";
}

export function normalizeSearchPr(raw: GhSearchPr): PrItem {
  return {
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: raw.author.login,
    ci: "none",
    review: "none",
    updatedAt: raw.updatedAt,
  };
}

async function enrichPr(pr: PrItem): Promise<PrItem> {
  const view = await ghJson<GhPrView>(["pr", "view", pr.url, "--json", "statusCheckRollup,reviewDecision"]);
  return { ...pr, ci: rollupCi(view.statusCheckRollup), review: view.reviewDecision || "none" };
}

async function searchAndEnrich(searchArgs: string[]): Promise<PrItem[]> {
  const raw = await ghJson<GhSearchPr[]>(searchArgs);
  const base = raw.map(normalizeSearchPr);
  return Promise.all(base.map(enrichPr));
}

const SEARCH_JSON = "number,title,url,repository,author,updatedAt,isDraft";

export async function fetchMyPrs(config: MyPrsConfig): Promise<MyPrsData> {
  const prs = await searchAndEnrich([
    "search", "prs", "--author=@me", "--state=open",
    "--json", SEARCH_JSON, "--limit", String(config.limit),
  ]);
  return { prs };
}

export async function fetchTeamPrs(config: TeamPrsConfig): Promise<TeamPrsData> {
  if (config.authors.length === 0) return { prs: [] };
  const authorArgs = config.authors.map((a) => `--author=${a}`);
  const prs = await searchAndEnrich([
    "search", "prs", ...authorArgs, "--state=open",
    "--json", SEARCH_JSON, "--limit", String(config.limit),
  ]);
  return { prs };
}
