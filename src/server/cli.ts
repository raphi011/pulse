import "server-only";
import { execFile } from "node:child_process";

export type CliErrorKind = "not-found" | "auth" | "failed";

export class CliError extends Error {
  constructor(message: string, readonly kind: CliErrorKind, readonly stderr = "") {
    super(message);
    this.name = "CliError";
  }
}

export interface RunCliOptions {
  notAuthenticatedPattern?: RegExp;
  notAuthenticatedMessage?: string;
}

/** Spawn a CLI with an arg array (no shell interpolation). Throws CliError on failure. */
export function runCli(
  bin: string,
  args: string[],
  opts: RunCliOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reject(new CliError(`${bin} not found — install it`, "not-found"));
      const errText = (stderr || "").toString();
      if (opts.notAuthenticatedPattern?.test(errText)) {
        return reject(new CliError(opts.notAuthenticatedMessage ?? "Not authenticated", "auth", errText));
      }
      return reject(new CliError(errText.trim() || `${bin} exited with an error`, "failed", errText));
    });
  });
}
