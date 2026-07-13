import { CliError } from "@/server/cli";
import type { IntegrationHealth } from "./integration-contracts";

/**
 * Run a lightweight probe and classify it. A `not-found` CliError means the tool isn't installed;
 * anything else means it's installed but we couldn't confirm auth (auth failure, timeout, broken probe).
 *
 * Pass `noAuth: true` for tools with no authentication concept (e.g. ccusage reads local logs): a
 * successful probe reports `authed: "n/a"` rather than faking `authed: true`.
 */
export async function probeHealth(
  run: () => Promise<unknown>,
  opts: { noAuth?: boolean } = {},
): Promise<IntegrationHealth> {
  const authedOk: boolean | "n/a" = opts.noAuth ? "n/a" : true;
  try {
    await run();
    return { installed: true, authed: authedOk };
  } catch (err) {
    if (err instanceof CliError && err.kind === "not-found") {
      return { installed: false, authed: false, detail: err.message };
    }
    // Installed but the probe failed. For a no-auth tool this isn't an auth problem, so keep "n/a";
    // the detail still carries the failure.
    return { installed: true, authed: opts.noAuth ? "n/a" : false, detail: err instanceof Error ? err.message : String(err) };
  }
}
