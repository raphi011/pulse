import "server-only";
import { execFile } from "node:child_process";

export type CliErrorKind = "not-found" | "auth" | "timeout" | "failed";

export class CliError extends Error {
  constructor(message: string, readonly kind: CliErrorKind, readonly stderr = "", readonly stdout = "") {
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
        new CliError(
          errText.trim() || (err as Error).message || `${bin} exited with an error`,
          "failed",
          errText,
          (stdout || "").toString(),
        ),
      );
    });
  });
}

export interface ApiError {
  code?: number;
  message?: string;
}

/** Pulls an embedded API error out of a parsed JSON body, or null if the call succeeded. */
export type ApiErrorExtractor = (body: unknown) => ApiError | null;

/**
 * For CLIs that wrap a REST API and report errors *inside* the JSON body on stdout —
 * sometimes with a zero exit code (e.g. `gws` returns an HTTP 401 as exit 0). The body is
 * authoritative, not the exit status, so we always parse and inspect it. Maps 401/403 to an
 * auth failure (using `notAuthenticatedMessage`); any other embedded error becomes `failed`.
 */
export async function runJsonCli<T>(
  bin: string,
  args: string[],
  extractError: ApiErrorExtractor,
  opts: RunCliOptions = {},
): Promise<T> {
  let stdout: string;
  try {
    ({ stdout } = await runCli(bin, args, opts));
  } catch (err) {
    // Non-zero exit (e.g. HTTP 404): the JSON error body is carried on the CliError.
    if (err instanceof CliError && err.stdout) stdout = err.stdout;
    else throw err;
  }

  let body: unknown;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new CliError(`${bin} returned non-JSON output`, "failed");
  }

  const apiError = extractError(body);
  if (apiError) {
    if (apiError.code === 401 || apiError.code === 403) {
      throw new CliError(opts.notAuthenticatedMessage ?? "Not authenticated", "auth");
    }
    throw new CliError(apiError.message?.trim() || `${bin} error ${apiError.code ?? ""}`.trim(), "failed");
  }
  return body as T;
}
