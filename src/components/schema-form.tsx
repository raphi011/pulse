"use client";
import type { ReactNode } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiChevronDown } from "react-icons/fi";
import { z, type ZodType } from "zod";
import { getFieldOptionsProvider, type FieldOption } from "@/modules/field-options";

export type FieldKind = "string" | "number" | "boolean" | "stringList" | "enum" | "asyncEnum" | "asyncMultiEnum";
export type Field = { key: string; label: string; kind: FieldKind; options?: string[]; optionsKey?: string; def?: unknown };

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

type JsonProp = {
  type?: string; description?: string; default?: unknown;
  enum?: string[]; items?: { type?: string }; optionsKey?: string;
};

export function describeSchema(schema: ZodType): Field[] {
  const json = z.toJSONSchema(schema) as { properties?: Record<string, JsonProp> };
  const props = json.properties ?? {};
  return Object.entries(props).map(([key, p]) => {
    const label = p.description ?? humanize(key);
    const def = p.default;
    if (p.optionsKey) {
      if (p.type === "string") return { key, label, kind: "asyncEnum", optionsKey: p.optionsKey, def };
      if (p.type === "array" && p.items?.type === "string")
        return { key, label, kind: "asyncMultiEnum", optionsKey: p.optionsKey, def };
      throw new Error(`optionsKey on unsupported field "${key}": ${p.type}`);
    }
    if (Array.isArray(p.enum)) return { key, label, kind: "enum", options: p.enum, def };
    switch (p.type) {
      case "string": return { key, label, kind: "string", def };
      case "number":
      case "integer": return { key, label, kind: "number", def };
      case "boolean": return { key, label, kind: "boolean", def };
      case "array":
        if (p.items?.type === "string") return { key, label, kind: "stringList", def };
        throw new Error(`Unsupported array item type for "${key}"`);
      default:
        throw new Error(`Unsupported field type for "${key}": ${p.type}`);
    }
  });
}

const inputCls =
  "w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-surface-dark dark:ring-border-dark";

// `appearance-none` strips the native control chrome so a <select> matches the text
// inputs (surface fill + ring); the chevron is drawn by SelectControl instead.
const selectCls = `${inputCls} appearance-none pr-8 disabled:opacity-60`;

/** A <select> styled to match the form's inputs, with a custom chevron. */
function SelectControl({
  id, ariaLabel, value, disabled, onChange, children,
}: {
  id: string;
  ariaLabel?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        aria-label={ariaLabel}
        className={selectCls}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <FiChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}

function StringListEditor({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  // Keep the raw typed text local so blank/intermediate lines survive editing;
  // only the cleaned array is propagated to the parent.
  const [text, setText] = useState(() => value.join("\n"));
  return (
    <>
      <textarea
        id={id}
        className={inputCls}
        rows={4}
        value={text}
        placeholder="one per line"
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
        }}
      />
      <p className="text-xs text-slate-500 dark:text-slate-400">One per line — press Enter for each.</p>
    </>
  );
}

function useFieldOptions(optionsKey: string) {
  const provider = getFieldOptionsProvider(optionsKey);
  return useQuery({
    queryKey: ["field-options", optionsKey],
    queryFn: () => provider!(),
    enabled: Boolean(provider),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function AsyncEnumField({
  id, label, optionsKey, value, onChange,
}: {
  id: string; label: string; optionsKey: string;
  value: string; onChange: (v: string | undefined) => void;
}) {
  const provider = getFieldOptionsProvider(optionsKey);
  const { data, isLoading, isError } = useFieldOptions(optionsKey);

  // No provider, or the fetch failed → plain text entry so the field still works.
  if (!provider || isError) {
    return (
      <input
        id={id}
        aria-label={label}
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const options: FieldOption[] = data ?? [];
  // Always show the current value, even if the fetch omitted it (stale/renamed selection).
  const hasCurrent = value === "" || options.some((o) => o.value === value);

  return (
    <SelectControl
      id={id}
      ariaLabel={label}
      disabled={isLoading}
      value={value}
      onChange={(v) => onChange(v || undefined)}
    >
      <option value="">Default</option>
      {!hasCurrent && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </SelectControl>
  );
}

// Above this many options the list gets a filter box; smaller lists stay bare.
const MULTI_ENUM_SEARCH_THRESHOLD = 8;

function AsyncMultiEnumField({
  id, label, optionsKey, value, onChange,
}: {
  id: string; label: string; optionsKey: string;
  value: string[]; onChange: (v: string[]) => void;
}) {
  const provider = getFieldOptionsProvider(optionsKey);
  const { data, isError } = useFieldOptions(optionsKey);
  const [query, setQuery] = useState("");

  if (!provider || isError) {
    return <StringListEditor id={id} value={value} onChange={onChange} />;
  }

  const options: FieldOption[] = data ?? [];
  // Selected values missing from the fetch still appear so nothing is silently dropped.
  const extras = value.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v, label: v }));
  const all = [...options, ...extras];
  const toggle = (v: string, on: boolean) =>
    onChange(on ? [...value, v] : value.filter((x) => x !== v));

  const showSearch = all.length > MULTI_ENUM_SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const visible = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;

  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      {showSearch && (
        <div className="flex items-center gap-2">
          <input
            type="search"
            aria-label={`Filter ${label}`}
            className={inputCls}
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {value.length > 0 && (
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{value.length} selected</span>
          )}
        </div>
      )}
      {/* Scroll rather than cap: a big space list stays fully browsable, and no
          selected item can be sliced off the bottom. */}
      <div className={`space-y-1.5 ${showSearch ? "max-h-48 overflow-y-auto pr-1" : ""}`}>
        {visible.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              checked={value.includes(o.value)}
              onChange={(e) => toggle(o.value, e.target.checked)}
            />
            {o.label}
          </label>
        ))}
        {visible.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">No matches.</p>
        )}
      </div>
    </div>
  );
}

export function SchemaForm({
  schema, values, onChange,
}: {
  schema: ZodType;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const fields = describeSchema(schema);
  const set = (key: string, val: unknown) => onChange({ ...values, [key]: val });

  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const id = `cfg-${f.key}`;
        if (f.kind === "boolean") {
          return (
            <label key={f.key} htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
              <input
                id={id}
                type="checkbox"
                className="h-4 w-4 rounded accent-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                checked={Boolean(values[f.key])}
                onChange={(e) => set(f.key, e.target.checked)}
              />
              {f.label}
            </label>
          );
        }
        return (
          <div key={f.key} className="space-y-1.5">
            <label htmlFor={id} className="block text-xs font-medium text-slate-600 dark:text-slate-300">{f.label}</label>
            {f.kind === "string" && (
              <input id={id} className={inputCls} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
            )}
            {f.kind === "number" && (
              <input
                id={id}
                type="number"
                className={inputCls}
                value={String(values[f.key] ?? f.def ?? "")}
                onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))}
              />
            )}
            {f.kind === "enum" && (
              <SelectControl
                id={id}
                value={String(values[f.key] ?? "")}
                onChange={(v) => set(f.key, v || undefined)}
              >
                <option value="">Any</option>
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </SelectControl>
            )}
            {f.kind === "stringList" && (
              <StringListEditor id={id} value={(values[f.key] as string[]) ?? []} onChange={(v) => set(f.key, v)} />
            )}
            {f.kind === "asyncEnum" && (
              <AsyncEnumField
                id={id} label={f.label} optionsKey={f.optionsKey!}
                value={String(values[f.key] ?? "")}
                onChange={(v) => set(f.key, v)}
              />
            )}
            {f.kind === "asyncMultiEnum" && (
              <AsyncMultiEnumField
                id={id} label={f.label} optionsKey={f.optionsKey!}
                value={(values[f.key] as string[]) ?? []}
                onChange={(v) => set(f.key, v)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
