import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Async field options are now Go-served (Dashboard.FieldOptions); the client-side
// field-options registry is gone. Mock the one binding SchemaForm reads.
// The real binding returns a Wails CancellablePromise; declaring the mock here
// (rather than via vi.mocked on the imported binding) keeps its type a plain
// Promise-returning Mock so .mockResolvedValue/.mockImplementation type-check.
const mocks = vi.hoisted(() => ({
  fieldOptions: vi.fn<(key: string) => Promise<{ value: string; label: string }[]>>(),
}));

vi.mock("@/lib/backend", () => ({ Dashboard: { FieldOptions: mocks.fieldOptions } }));

import { SchemaForm, type Field } from "@/components/schema-form";

const mockFieldOptions = mocks.fieldOptions;

const tasklistField: Field = { key: "tasklist", label: "Task list", kind: "asyncEnum", optionsKey: "test.lists" };
const spacesField: Field = { key: "spaceIds", label: "Spaces", kind: "asyncMultiEnum", optionsKey: "test.spaces" };

function renderForm(fields: Field[], values: Record<string, unknown>) {
  const onChange = vi.fn();
  render(
    // retry:false so an erroring provider settles immediately in the test
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SchemaForm fields={fields} values={values} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

// No shared beforeEach reset: every test sets its own mock behavior before
// rendering, and (empirically) resetting the mock from a `beforeEach` hook
// specifically — as opposed to inline in the test body — causes an erroring
// implementation's rejection to surface as an unhandled rejection here.

describe("SchemaForm asyncEnum", () => {
  it("renders fetched options in a select", async () => {
    mockFieldOptions.mockResolvedValue([
      { value: "id1", label: "Tasks" },
      { value: "id2", label: "Other" },
    ]);
    renderForm([tasklistField], { tasklist: "id2" });
    const select = await screen.findByRole("combobox", { name: "Task list" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument());
    expect(select).toHaveValue("id2");
    expect(mockFieldOptions).toHaveBeenCalledWith("test.lists");
  });

  it("keeps the current value as an option when the fetch omits it", async () => {
    mockFieldOptions.mockResolvedValue([{ value: "id1", label: "Tasks" }]);
    renderForm([tasklistField], { tasklist: "stale-id" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Task list" })).toHaveValue("stale-id"),
    );
  });

  it("falls back to a text input when the provider errors", async () => {
    // mockImplementation (lazy) rather than mockRejectedValue (eager): the latter
    // constructs the rejected Promise immediately, which Node/Vitest can flag as
    // an unhandled rejection before React Query gets a chance to attach a catch.
    mockFieldOptions.mockImplementation(async () => { throw new Error("403 insufficient scopes"); });
    renderForm([tasklistField], { tasklist: "id1" });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Task list" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Task list" })).toHaveValue("id1");
  });
});

describe("SchemaForm asyncMultiEnum", () => {
  it("renders fetched options as checkboxes, with the selected value checked", async () => {
    mockFieldOptions.mockResolvedValue([
      { value: "spaces/A", label: "Team A" },
      { value: "spaces/B", label: "Team B" },
    ]);
    renderForm([spacesField], { spaceIds: ["spaces/A"] });

    const group = await screen.findByRole("group", { name: "Spaces" });
    expect(group).toBeInTheDocument();

    const checkboxA = await screen.findByRole("checkbox", { name: "Team A" });
    const checkboxB = screen.getByRole("checkbox", { name: "Team B" });
    expect(checkboxA).toBeChecked();
    expect(checkboxB).not.toBeChecked();
  });

  it("keeps a selected value missing from the fetch as a checked extra option", async () => {
    mockFieldOptions.mockResolvedValue([{ value: "spaces/A", label: "Team A" }]);
    renderForm([spacesField], { spaceIds: ["spaces/GONE"] });

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "spaces/GONE" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("checkbox", { name: "spaces/GONE" })).toBeChecked();
  });

  it("falls back to the string-list editor when the provider errors", async () => {
    mockFieldOptions.mockImplementation(async () => { throw new Error("403 insufficient scopes"); });
    renderForm([spacesField], { spaceIds: ["spaces/A"] });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Spaces" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Spaces" })).toHaveValue("spaces/A");
  });

  it("shows no filter box for a short list", async () => {
    mockFieldOptions.mockResolvedValue([
      { value: "spaces/A", label: "Team A" },
      { value: "spaces/B", label: "Team B" },
    ]);
    renderForm([spacesField], { spaceIds: [] });

    await screen.findByRole("checkbox", { name: "Team A" });
    expect(screen.queryByRole("searchbox", { name: "Filter Spaces" })).not.toBeInTheDocument();
  });

  it("filters a long list by label and reports the selected count", async () => {
    mockFieldOptions.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ value: `spaces/${i}`, label: `Team ${i}` })),
    );
    renderForm([spacesField], { spaceIds: ["spaces/3"] });

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
