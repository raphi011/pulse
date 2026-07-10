import "server-only";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

let cachedServer: string | null = null;

/** Base URL of the Jira instance, read from jira-cli's config (`server:`). Cached. */
export function jiraServerUrl(): string {
  if (cachedServer) return cachedServer;
  const path = process.env.JIRA_CONFIG_FILE ?? join(homedir(), ".config", ".jira", ".config.yml");
  const text = readFileSync(path, "utf8");
  const match = text.match(/^server:\s*(\S+)/m);
  if (!match) throw new Error("Could not find `server:` in jira-cli config — run `jira init`");
  cachedServer = match[1].replace(/\/$/, "");
  return cachedServer;
}
