import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchemaForm, type Field } from "@/components/schema-form";

// Field derivation from a Zod schema (describeSchema) moved server-side (Go);
// the manifest's configFields now arrive pre-derived as Field[]. These tests
// exercise SchemaForm directly against Field[] fixtures for each sync kind.
// asyncEnum/asyncMultiEnum (which hit Dashboard.FieldOptions) are covered in
// schema-form-async.test.tsx.
function renderForm(fields: Field[], values: Record<string, unknown>) {
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaForm fields={fields} values={values} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("SchemaForm", () => {
  it("renders a string field and propagates edits", () => {
    const onChange = renderForm(
      [{ key: "title", label: "Title", kind: "string" }],
      { title: "hi" },
    );
    const input = screen.getByLabelText("Title");
    expect(input).toHaveValue("hi");
    fireEvent.change(input, { target: { value: "bye" } });
    expect(onChange).toHaveBeenCalledWith({ title: "bye" });
  });

  it("renders a number field, showing the default as a placeholder when cleared", () => {
    const onChange = renderForm(
      [{ key: "limit", label: "Max", kind: "number", def: 10 }],
      { limit: 5 },
    );
    const input = screen.getByLabelText("Max");
    expect(input).toHaveValue(5);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ limit: undefined });
    expect(input).toHaveAttribute("placeholder", "10");
  });

  it("renders a boolean field as a checkbox", () => {
    const onChange = renderForm(
      [{ key: "enabled", label: "Enabled", kind: "boolean" }],
      { enabled: false },
    );
    const checkbox = screen.getByLabelText("Enabled");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });

  it("renders a stringList field as a textarea, one entry per line", () => {
    const onChange = renderForm(
      [{ key: "repos", label: "Repos", kind: "stringList" }],
      { repos: ["a/b"] },
    );
    const textarea = screen.getByLabelText("Repos");
    expect(textarea).toHaveValue("a/b");
    fireEvent.change(textarea, { target: { value: "a/b\nc/d" } });
    expect(onChange).toHaveBeenCalledWith({ repos: ["a/b", "c/d"] });
  });

  it("renders an enum field as a select with an Any default option", () => {
    const onChange = renderForm(
      [{ key: "severity", label: "Min severity", kind: "enum", options: ["low", "high"] }],
      { severity: "low" },
    );
    const select = screen.getByLabelText("Min severity");
    expect(select).toHaveValue("low");
    expect(screen.getByRole("option", { name: "Any" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "high" } });
    expect(onChange).toHaveBeenCalledWith({ severity: "high" });
  });

  it("renders multiple fields together, each independently editable", () => {
    const onChange = renderForm(
      [
        { key: "title", label: "Title", kind: "string" },
        { key: "enabled", label: "Enabled", kind: "boolean" },
      ],
      { title: "x", enabled: true },
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith({ title: "y", enabled: true });
  });
});
