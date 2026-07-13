import { readTextFile } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
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
let cachedAt = 0;
// Cache with a TTL rather than for the whole process lifetime: a `jira init` to a different server
// then self-heals within a few minutes instead of requiring an app restart.
const SERVER_TTL_MS = 5 * 60_000;

/** Base URL of the Jira instance, read from jira-cli's config (`server:`). Cached (TTL). */
export async function jiraServerUrl(): Promise<string> {
  if (cachedServer && Date.now() - cachedAt < SERVER_TTL_MS) return cachedServer;
  const path = await join(await homeDir(), ".config", ".jira", ".config.yml");
  const text = await readTextFile(path);
  const match = text.match(/^server:\s*(\S+)/m);
  if (!match) throw new Error("Could not find `server:` in jira-cli config — run `jira init`");
  cachedServer = match[1].replace(/^["']|["']$/g, "").replace(/\/$/, "");
  cachedAt = Date.now();
  return cachedServer;
}
