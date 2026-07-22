import { describe, it, expect, vi, beforeEach } from "vitest";

// plugin-fs / api-path call invoke() under the hood — unavailable in Node, so mock them.
const readTextFile = vi.fn<(path: string) => Promise<string>>();
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: (p: string) => readTextFile(p) }));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: () => Promise.resolve("/Users/test"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

// jiraServerUrl caches at module scope, so re-import a fresh module per test.
async function freshServerUrl() {
  vi.resetModules();
  return (await import("@/modules/jira/jira")).jiraServerUrl;
}

beforeEach(() => {
  readTextFile.mockReset();
});

describe("jiraServerUrl", () => {
  it("reads server: from the jira-cli config, stripping quotes and trailing slash", async () => {
    readTextFile.mockResolvedValue(
      'installation: Cloud\nserver: "https://x.atlassian.net/"\nlogin: a@b.com\n',
    );
    const jiraServerUrl = await freshServerUrl();
    expect(await jiraServerUrl()).toBe("https://x.atlassian.net");
    // reads the config under the resolved home dir
    expect(readTextFile).toHaveBeenCalledWith("/Users/test/.config/.jira/.config.yml");
  });

  it("caches the result — the config file is read only once across calls", async () => {
    readTextFile.mockResolvedValue('server: https://y.atlassian.net\n');
    const jiraServerUrl = await freshServerUrl();
    await jiraServerUrl();
    await jiraServerUrl();
    await jiraServerUrl();
    expect(readTextFile).toHaveBeenCalledTimes(1);
  });

  it("throws when the config has no server: line", async () => {
    readTextFile.mockResolvedValue("installation: Cloud\nlogin: a@b.com\n");
    const jiraServerUrl = await freshServerUrl();
    await expect(jiraServerUrl()).rejects.toThrow(/Could not find `server:`/);
  });
});
