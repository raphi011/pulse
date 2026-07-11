import { runJsonCli, type ApiError } from "@/server/cli";

// gws prints Google API errors as `{ "error": { code, message, reason } }` on stdout,
// sometimes with a zero exit code — so the body is authoritative, not the exit status.
const extractGwsError = (body: unknown): ApiError | null => {
  const err = (body as { error?: { code?: number; message?: string } }).error;
  return err ? { code: err.code, message: err.message } : null;
};

/** Run a gws command and return its parsed JSON, mapping embedded API errors to CliError. */
export function gwsJson<T>(args: string[]): Promise<T> {
  return runJsonCli<T>("gws", args, extractGwsError, {
    notAuthenticatedMessage: "Not authenticated — run `gws auth login`",
  });
}
