import { describe, it, expect } from "vitest";
import { JIRA_AUTH_PATTERN } from "@/modules/jira/jira";

describe("JIRA_AUTH_PATTERN", () => {
  it("matches jira-cli's unconfigured-token message", () => {
    expect(JIRA_AUTH_PATTERN.test("The tool needs a Jira API token to function.")).toBe(true);
  });

  it("matches a 401 unauthorized error", () => {
    expect(JIRA_AUTH_PATTERN.test("Received unexpected response '401 Unauthorized'")).toBe(true);
  });

  it("does not match an ordinary JQL error", () => {
    expect(JIRA_AUTH_PATTERN.test("Error in the JQL Query: expecting operator but got 'foo'")).toBe(false);
  });
});
