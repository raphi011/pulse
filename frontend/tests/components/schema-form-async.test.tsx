import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import { SchemaForm } from "@/components/schema-form";
import {
  registerFieldOptions,
  __clearFieldOptionsRegistry,
  type FieldOption,
} from "@/modules/field-options";

const schema = z.object({
  tasklist: z.string().default("@default").meta({ optionsKey: "test.lists" }).describe("Task list"),
});

const multiSchema = z.object({
  spaceIds: z.array(z.string()).default([]).meta({ optionsKey: "test.spaces" }).describe("Spaces"),
});

function renderForm(values: Record<string, unknown>) {
  const onChange = vi.fn();
  render(
    // retry:false so an erroring provider settles immediately in the test
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SchemaForm schema={schema} values={values} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

function renderMultiForm(values: Record<string, unknown>) {
  const onChange = vi.fn();
  render(
    // retry:false so an erroring provider settles immediately in the test
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SchemaForm schema={multiSchema} values={values} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

beforeEach(() => __clearFieldOptionsRegistry());

describe("SchemaForm asyncEnum", () => {
  it("renders fetched options in a select", async () => {
    const opts: FieldOption[] = [
      { value: "id1", label: "Tasks" },
      { value: "id2", label: "Other" },
    ];
    registerFieldOptions("test.lists", async () => opts);
    renderForm({ tasklist: "id2" });
    const select = await screen.findByRole("combobox", { name: "Task list" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument());
    expect(select).toHaveValue("id2");
  });

  it("keeps the current value as an option when the fetch omits it", async () => {
    registerFieldOptions("test.lists", async () => [{ value: "id1", label: "Tasks" }]);
    renderForm({ tasklist: "stale-id" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Task list" })).toHaveValue("stale-id"),
    );
  });

  it("falls back to a text input when the provider errors", async () => {
    registerFieldOptions("test.lists", async () => {
      throw new Error("403 insufficient scopes");
    });
    renderForm({ tasklist: "id1" });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Task list" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Task list" })).toHaveValue("id1");
  });

  it("falls back to a text input when no provider is registered for the optionsKey", async () => {
    renderForm({ tasklist: "id1" });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Task list" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Task list" })).toHaveValue("id1");
  });
});

describe("SchemaForm asyncMultiEnum", () => {
  it("renders fetched options as checkboxes, with the selected value checked", async () => {
    const opts: FieldOption[] = [
      { value: "spaces/A", label: "Team A" },
      { value: "spaces/B", label: "Team B" },
    ];
    registerFieldOptions("test.spaces", async () => opts);
    renderMultiForm({ spaceIds: ["spaces/A"] });

    const group = await screen.findByRole("group", { name: "Spaces" });
    expect(group).toBeInTheDocument();

    const checkboxA = await screen.findByRole("checkbox", { name: "Team A" });
    const checkboxB = screen.getByRole("checkbox", { name: "Team B" });
    expect(checkboxA).toBeChecked();
    expect(checkboxB).not.toBeChecked();
  });

  it("keeps a selected value missing from the fetch as a checked extra option", async () => {
    registerFieldOptions("test.spaces", async () => [{ value: "spaces/A", label: "Team A" }]);
    renderMultiForm({ spaceIds: ["spaces/GONE"] });

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "spaces/GONE" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("checkbox", { name: "spaces/GONE" })).toBeChecked();
  });

  it("falls back to the string-list editor when the provider errors", async () => {
    registerFieldOptions("test.spaces", async () => {
      throw new Error("403 insufficient scopes");
    });
    renderMultiForm({ spaceIds: ["spaces/A"] });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Spaces" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Spaces" })).toHaveValue("spaces/A");
  });

  it("shows no filter box for a short list", async () => {
    registerFieldOptions("test.spaces", async () => [
      { value: "spaces/A", label: "Team A" },
      { value: "spaces/B", label: "Team B" },
    ]);
    renderMultiForm({ spaceIds: [] });

    await screen.findByRole("checkbox", { name: "Team A" });
    expect(screen.queryByRole("searchbox", { name: "Filter Spaces" })).not.toBeInTheDocument();
  });

  it("filters a long list by label and reports the selected count", async () => {
    const opts: FieldOption[] = Array.from({ length: 12 }, (_, i) => ({
      value: `spaces/${i}`,
      label: `Team ${i}`,
    }));
    registerFieldOptions("test.spaces", async () => opts);
    renderMultiForm({ spaceIds: ["spaces/3"] });

    // Long list → filter box appears, with the selected count.
    const search = await screen.findByRole("searchbox", { name: "Filter Spaces" });
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Team 11" })).toBeInTheDocument();

    // Typing narrows the visible checkboxes; "Team 1" also matches "Team 10"/"Team 11".
    await userEvent.type(search, "Team 11");
    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: "Team 2" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("checkbox", { name: "Team 11" })).toBeInTheDocument();

    // A non-matching query shows the empty state.
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    await waitFor(() => expect(screen.getByText("No matches.")).toBeInTheDocument());
  });
});
