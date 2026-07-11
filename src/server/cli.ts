import { Command } from "@tauri-apps/plugin-shell";

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

// Homebrew-inclusive PATH: a Finder-launched .app inherits only the minimal system PATH,
// so prepend the common Homebrew dirs where gh/jira/gws live. (Simpler + more robust than a
// login-shell probe, which would require allowlisting the user's shell. Revisit only if a
// tool lives elsewhere.)
const TOOL_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/** Pure: turn a finished process result into a resolved value or a CliError. Unit-testable. */
export function classifyExit(
  bin: string,
  code: number | null,
  stdout: string,
  stderr: string,
  opts: RunCliOptions,
): { stdout: string; stderr: string } {
  if (code === 0) return { stdout, stderr };
  if (opts.notAuthenticatedPattern?.test(stderr)) {
    throw new CliError(opts.notAuthenticatedMessage ?? "Not authenticated", "auth", stderr, stdout);
  }
  throw new CliError(stderr.trim() || `${bin} exited with code ${code ?? "unknown"}`, "failed", stderr, stdout);
}

/** Pure: classify a spawn/exec failure (missing binary → not-found). Unit-testable. */
export function classifySpawnError(bin: string, message: string): CliError {
  if (/not found|no such file|os error 2|cannot find|failed to (spawn|execute)/i.test(message)) {
    return new CliError(`${bin} not found — install it`, "not-found");
  }
  return new CliError(message || `${bin} failed to start`, "failed");
}

/** Spawn a CLI with an arg array (no shell interpolation). Throws CliError on failure. */
export function runCli(
  bin: string,
  args: string[],
  opts: RunCliOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const cmd = Command.create(bin, args, { env: { PATH: TOOL_PATH } });

    cmd.stdout.on("data", (line) => {
      stdout += line + "\n";
    });
    cmd.stderr.on("data", (line) => {
      stderr += line + "\n";
    });

    cmd.on("error", (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(classifySpawnError(bin, String(msg)));
    });

    cmd.on("close", ({ code }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(classifyExit(bin, code, stdout, stderr, opts));
      } catch (e) {
        reject(e);
      }
    });

    let child: { kill: () => Promise<void> } | undefined;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void child?.kill();
      reject(new CliError(`${bin} timed out after ${timeoutMs / 1000}s`, "timeout"));
    }, timeoutMs);

    cmd
      .spawn()
      .then((c) => {
        child = c;
        // If the timeout already fired before spawn resolved, `child` was still
        // undefined then, so the timer's kill was a no-op — kill the leaked child now.
        if (settled) void c.kill();
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(classifySpawnError(bin, String(e)));
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
