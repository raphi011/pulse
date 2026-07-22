import { registerFetch } from "@/modules/fetch-registry";
import { CliError } from "@/server/cli";
import { ccusageSpendManifest, type CcusageSpendConfig, type CcusageSpendData } from "./manifest";
import { runCcusage } from "./ccusage";

/** Today's local date as ccusage's compact `YYYYMMDD` plus a display `YYYY-MM-DD`. */
function today(): { compact: string; iso: string } {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { compact: `${y}${m}${d}`, iso: `${y}-${m}-${d}` };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- config kept to match the registerFetch(config) => Promise<Data> shape
export async function fetchCcusage(_config: CcusageSpendConfig): Promise<CcusageSpendData> {
  const { compact, iso } = today();
  const { stdout } = await runCcusage(["daily", "--json", "--since", compact, "--until", compact]);
  let body: { totals?: { totalCost?: number } };
  try {
    body = JSON.parse(stdout);
  } catch {
    // A non-JSON preamble (e.g. an npx install banner) shouldn't surface as a raw
    // SyntaxError — classify it like the other CLI modules do.
    throw new CliError("ccusage returned non-JSON output", "failed");
  }
  return { costUsd: body.totals?.totalCost ?? 0, date: iso };
}

registerFetch(ccusageSpendManifest, { fetch: fetchCcusage });
