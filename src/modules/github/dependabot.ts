import { ghJson } from "./gh";
import type { AlertItem, Severity, DependabotData, DependabotConfig } from "./manifest";

export type GhAlert = {
  html_url: string;
  security_advisory: { summary: string; severity: Severity };
  security_vulnerability: { package: { name: string; ecosystem: string } };
};

// Ascending severity — index doubles as a rank for floor-filtering and sorting.
const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];
const severityRank = (s: Severity) => SEVERITY_ORDER.indexOf(s);

export function normalizeAlert(repo: string, raw: GhAlert): AlertItem {
  return {
    repo,
    package: raw.security_vulnerability.package.name,
    severity: raw.security_advisory.severity,
    summary: raw.security_advisory.summary,
    url: raw.html_url,
  };
}

export async function fetchDependabot(config: DependabotConfig): Promise<DependabotData> {
  if (config.repos.length === 0) return { alerts: [] };
  const results = await Promise.allSettled(
    config.repos.map(async (repo) => {
      const raw = await ghJson<GhAlert[]>([
        "api", `/repos/${repo}/dependabot/alerts?state=open&per_page=50`,
      ]);
      return raw.map((a) => normalizeAlert(repo, a));
    }),
  );
  if (results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  // REST `severity` is exact-match, not a floor (picking "high" would drop "critical"),
  // so treat it as a minimum client-side. Sort most-severe first before the widget slices,
  // so a noisy repo can't mask a more urgent alert from another.
  const min = config.severity ? severityRank(config.severity) : 0;
  const alerts = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((a) => severityRank(a.severity) >= min)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const errors = config.repos.filter((_, i) => results[i].status === "rejected");
  return errors.length ? { alerts, errors } : { alerts };
}
