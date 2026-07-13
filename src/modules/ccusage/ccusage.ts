import { runCli } from "@/server/cli";

/** Run the ccusage CLI. Process-model: exit 0 with JSON on stdout; missing binary → not-found. */
export function runCcusage(args: string[]) {
  return runCli("ccusage", args, { timeoutMs: 20000 });
}
