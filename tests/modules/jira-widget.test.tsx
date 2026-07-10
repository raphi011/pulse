import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { JqlWidget } from "@/modules/jira/widgets/jql-widget";
import type { JqlData, JqlConfig } from "@/modules/jira/manifest";

const config: JqlConfig = { jql: "project = CORE", limit: 10 };
const noop = async () => {};

const data: JqlData = {
  issues: [
    { key: "CORE-101", summary: "Fix seizure edge case", status: "In Progress",
      statusCategory: "inprogress", assignee: "Raphael Gruber",
      url: "https://x.atlassian.net/browse/CORE-101" },
  ],
};

describe("JqlWidget", () => {
  it("renders each issue as a link to its browse URL", () => {
    render(<JqlWidget data={data} config={config} runAction={noop} />);
    expect(screen.getByText("CORE-101")).toBeInTheDocument();
    expect(screen.getByText(/Fix seizure edge case/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://x.atlassian.net/browse/CORE-101");
  });

  it("shows an empty message when there are no issues", () => {
    render(<JqlWidget data={{ issues: [] }} config={config} runAction={noop} />);
    expect(screen.getByText(/no matching issues/i)).toBeInTheDocument();
  });

  it("renders assignee initials, the unassigned fallback, and status pill text", () => {
    const twoIssues: JqlData = {
      issues: [
        { key: "CORE-101", summary: "Fix seizure edge case", status: "In Progress",
          statusCategory: "inprogress", assignee: "Raphael Gruber",
          url: "https://x.atlassian.net/browse/CORE-101" },
        { key: "CORE-102", summary: "Unassigned todo", status: "To Do",
          statusCategory: "todo", assignee: null,
          url: "https://x.atlassian.net/browse/CORE-102" },
      ],
    };
    render(<JqlWidget data={twoIssues} config={config} runAction={noop} />);
    expect(screen.getByText("RG")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });
});
