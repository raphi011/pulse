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
