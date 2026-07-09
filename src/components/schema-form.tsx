"use client";
import { z, type ZodType } from "zod";

export type FieldKind = "string" | "number" | "boolean" | "stringList" | "enum";
export type Field = { key: string; label: string; kind: FieldKind; options?: string[]; def?: unknown };

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

type JsonProp = {
  type?: string; description?: string; default?: unknown;
  enum?: string[]; items?: { type?: string };
};

export function describeSchema(schema: ZodType): Field[] {
  const json = z.toJSONSchema(schema) as { properties?: Record<string, JsonProp> };
  const props = json.properties ?? {};
  return Object.entries(props).map(([key, p]) => {
    const label = p.description ?? humanize(key);
    const def = p.default;
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

function StringListEditor({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <textarea
      id={id}
      className={inputCls}
      rows={4}
      value={value.join("\n")}
      placeholder="one per line"
      onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
    />
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
              <select
                id={id}
                className={inputCls}
                value={String(values[f.key] ?? "")}
                onChange={(e) => set(f.key, e.target.value || undefined)}
              >
                <option value="">Any</option>
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.kind === "stringList" && (
              <StringListEditor id={id} value={(values[f.key] as string[]) ?? []} onChange={(v) => set(f.key, v)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
