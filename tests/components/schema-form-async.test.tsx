import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
