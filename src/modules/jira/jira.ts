import "server-only";
import { runCli } from "@/server/cli";

export const JIRA_AUTH_PATTERN = /needs a Jira API token|unauthorized|401|invalid credentials/i;

export async function runJira(args: string[]): Promise<string> {
  const { stdout } = await runCli("jira", args, {
    notAuthenticatedPattern: JIRA_AUTH_PATTERN,
    notAuthenticatedMessage: "Not authenticated — run `jira init`",
  });
  return stdout;
}

export async function jiraJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await runJira([...args, "--raw"])) as T;
}
