import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jiraServerUrl } from "@/modules/jira/jira";

describe("jiraServerUrl", () => {
  it("reads server: from the jira-cli config, stripping quotes and trailing slash", () => {
    const dir = mkdtempSync(join(tmpdir(), "jira-cfg-"));
    const cfg = join(dir, "config.yml");
    writeFileSync(cfg, 'installation: Cloud\nserver: "https://x.atlassian.net/"\nlogin: a@b.com\n');
    process.env.JIRA_CONFIG_FILE = cfg;
    expect(jiraServerUrl()).toBe("https://x.atlassian.net");
  });
});
