import { ghJson } from "./gh";
import type { AlertItem, Severity, DependabotData, DependabotConfig } from "./manifest";

export type GhAlert = {
  html_url: string;
  security_advisory: { summary: string; severity: Severity };
  security_vulnerability: { package: { name: string; ecosystem: string } };
};

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
  const sev = config.severity ? `&severity=${config.severity}` : "";
  const results = await Promise.allSettled(
    config.repos.map(async (repo) => {
      const raw = await ghJson<GhAlert[]>([
        "api", `/repos/${repo}/dependabot/alerts?state=open&per_page=50${sev}`,
      ]);
      return raw.map((a) => normalizeAlert(repo, a));
    }),
  );
  if (results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  const alerts = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const errors = config.repos.filter((_, i) => results[i].status === "rejected");
  return errors.length ? { alerts, errors } : { alerts };
}
