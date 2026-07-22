import { runCli } from "@/server/cli";

const GH_AUTH_PATTERN = /gh auth login|not logged in|authentication|HTTP 401|Bad credentials/i;

export async function runGh(args: string[]): Promise<string> {
  const { stdout } = await runCli("gh", args, {
    notAuthenticatedPattern: GH_AUTH_PATTERN,
    notAuthenticatedMessage: "Not authenticated — run `gh auth login`",
  });
  return stdout;
}

export async function ghJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await runGh(args)) as T;
}
