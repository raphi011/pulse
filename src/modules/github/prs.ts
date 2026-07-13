import { ghJson } from "./gh";
import type { CiStatus, PrItem, PrsData, PrsConfig } from "./manifest";

export type GhSearchPr = {
  number: number; title: string; url: string;
  repository: { nameWithOwner: string };
  author: { login: string };
  updatedAt: string;
};

type GhCheck = { status?: string; conclusion?: string; state?: string };
type GhPrView = { statusCheckRollup?: GhCheck[]; reviewDecision?: string };

const FAIL = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const PENDING = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"]);

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
  const settled = await Promise.allSettled(base.map(enrichPr));
  return settled.map((r, i) => (r.status === "fulfilled" ? r.value : base[i]));
}

const SEARCH_JSON = "number,title,url,repository,author,updatedAt";

function dedupeByUrl(prs: PrItem[]): PrItem[] {
  const seen = new Map<string, PrItem>();
  for (const pr of prs) if (!seen.has(pr.url)) seen.set(pr.url, pr);
  return [...seen.values()];
}

export async function fetchPrs(config: PrsConfig): Promise<PrsData> {
  // Blank authors → your own open PRs; otherwise the listed teammates'.
  // `gh search prs --author` is single-valued (last flag wins), so each author
  // needs its own search; we merge, sort by recency, and cap to the limit.
  const authors = config.authors.length ? config.authors : ["@me"];
  const settled = await Promise.allSettled(
    authors.map((author) =>
      searchAndEnrich([
        "search", "prs", `--author=${author}`, "--state=open",
        "--json", SEARCH_JSON, "--limit", String(config.limit),
      ]),
    ),
  );
  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<PrItem[]> => r.status === "fulfilled");
  // A single bad author shouldn't sink the widget, but a total failure (e.g.
  // auth) must surface rather than caching an empty "ok" result.
  if (fulfilled.length === 0 && settled.length > 0) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  const prs = dedupeByUrl(fulfilled.flatMap((r) => r.value))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, config.limit);
  return { prs };
}
