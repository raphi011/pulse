import "server-only";
import { CliError } from "@/server/cli";
import type { IntegrationHealth } from "./integration-contracts";

/**
 * Run a lightweight authenticated probe and classify it. A `not-found` CliError
 * means the tool isn't installed; anything else means it's installed but we
 * couldn't confirm auth (auth failure, timeout, or a broken probe).
 */
export async function probeHealth(run: () => Promise<unknown>): Promise<IntegrationHealth> {
  try {
    await run();
    return { installed: true, authed: true };
  } catch (err) {
    if (err instanceof CliError && err.kind === "not-found") {
      return { installed: false, authed: false, detail: err.message };
    }
    return { installed: true, authed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
