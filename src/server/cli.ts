import "server-only";
import { execFile } from "node:child_process";

export type CliErrorKind = "not-found" | "auth" | "timeout" | "failed";

export class CliError extends Error {
  constructor(message: string, readonly kind: CliErrorKind, readonly stderr = "") {
    super(message);
    this.name = "CliError";
  }
}

export interface RunCliOptions {
  notAuthenticatedPattern?: RegExp;
  notAuthenticatedMessage?: string;
  timeoutMs?: number;
}

/** Spawn a CLI with an arg array (no shell interpolation). Throws CliError on failure. */
export function runCli(
  bin: string,
  args: string[],
  opts: RunCliOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reject(new CliError(`${bin} not found — install it`, "not-found"));
      // maxBuffer overflow also sets killed:true, so classify it before the timeout check.
      if (code === "ERR_CHILD_PROCESS_STDOUT_MAXBUFFER") {
        return reject(new CliError(`${bin} output too large`, "failed"));
      }
      if ((err as { killed?: boolean }).killed) {
        return reject(new CliError(`${bin} timed out after ${timeoutMs / 1000}s`, "timeout"));
      }
      const errText = (stderr || "").toString();
      if (opts.notAuthenticatedPattern?.test(errText)) {
        return reject(new CliError(opts.notAuthenticatedMessage ?? "Not authenticated", "auth", errText));
      }
      return reject(
        new CliError(errText.trim() || (err as Error).message || `${bin} exited with an error`, "failed", errText),
      );
    });
  });
}
