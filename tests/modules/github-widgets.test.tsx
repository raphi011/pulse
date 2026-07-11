import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrListWidget } from "@/modules/github/widgets/pr-list-widget";
import { FailingActionsWidget } from "@/modules/github/widgets/failing-actions-widget";
import { DependabotWidget } from "@/modules/github/widgets/dependabot-widget";

const noop = async () => {};

const mkPr = (n: number) => ({
  repo: "o/r", number: n, title: `PR ${n}`, url: `https://x/${n}`,
  author: "me", ci: "none" as const, review: "none", updatedAt: "",
});

describe("PrListWidget", () => {
  it("shows the empty result when there are no PRs (blank authors is valid)", () => {
    render(<PrListWidget data={{ prs: [] }} config={{ authors: [], limit: 20 }} saveConfig={noop} />);
    expect(screen.getByText(/no open prs/i)).toBeInTheDocument();
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  it("caps the rendered list to config.limit", () => {
    render(
      <PrListWidget data={{ prs: [mkPr(1), mkPr(2), mkPr(3)] }} config={{ authors: [], limit: 2 }} saveConfig={noop} />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("FailingActionsWidget", () => {
  it("nudges to Configure when no repos", () => {
    render(<FailingActionsWidget data={{ runs: [] }} config={{ repos: [], limit: 10 }} saveConfig={noop} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });

  it("shows a partial-failure footer alongside results", () => {
    render(
      <FailingActionsWidget
        data={{
          runs: [{ repo: "o/r", name: "CI", url: "u", branch: "main", event: "push", createdAt: "" }],
          errors: ["o/bad"],
        }}
        config={{ repos: ["o/r", "o/bad"], limit: 10 }} saveConfig={noop}
      />,
    );
    expect(screen.getByText(/1 repo failed to load/i)).toBeInTheDocument();
  });
});

describe("DependabotWidget", () => {
  it("nudges to Configure when no repos", () => {
    render(<DependabotWidget data={{ alerts: [] }} config={{ repos: [], limit: 10 }} saveConfig={noop} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });

  it("pluralizes the partial-failure footer", () => {
    render(
      <DependabotWidget
        data={{ alerts: [], errors: ["o/a", "o/b"] }}
        config={{ repos: ["o/a", "o/b"], limit: 10 }} saveConfig={noop}
      />,
    );
    expect(screen.getByText(/2 repos failed to load/i)).toBeInTheDocument();
  });

  it("caps the rendered alerts to config.limit", () => {
    const alert = (pkg: string) => ({ repo: "o/r", package: pkg, severity: "high" as const, summary: "x", url: `u-${pkg}` });
    render(
      <DependabotWidget
        data={{ alerts: [alert("a"), alert("b"), alert("c")] }}
        config={{ repos: ["o/r"], limit: 2 }} saveConfig={noop}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
