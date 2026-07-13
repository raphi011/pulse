import { describe, it, expect } from "vitest";
import { z } from "zod";
import { describeSchema } from "@/components/schema-form";

describe("describeSchema", () => {
  it("derives fields with kind, label and default", () => {
    const schema = z.object({
      repos: z.array(z.string()).default([]).describe("Repos (owner/name)"),
      limit: z.number().int().default(10).describe("Max"),
      enabled: z.boolean().default(false),
      severity: z.enum(["low", "high"]).optional().describe("Min severity"),
    });
    const fields = describeSchema(schema);
    expect(fields).toEqual([
      { key: "repos", label: "Repos (owner/name)", kind: "stringList", def: [] },
      { key: "limit", label: "Max", kind: "number", def: 10 },
      { key: "enabled", label: "Enabled", kind: "boolean", def: false },
      { key: "severity", label: "Min severity", kind: "enum", options: ["low", "high"], def: undefined },
    ]);
  });

  it("throws on an unsupported field kind", () => {
    const schema = z.object({ nested: z.object({ a: z.string() }) });
    expect(() => describeSchema(schema)).toThrow(/Unsupported/);
  });

  it("derives an asyncEnum for a string field carrying optionsKey", () => {
    const schema = z.object({
      tasklist: z.string().default("@default").meta({ optionsKey: "gws.taskLists" }).describe("Task list"),
    });
    expect(describeSchema(schema)).toEqual([
      { key: "tasklist", label: "Task list", kind: "asyncEnum", optionsKey: "gws.taskLists", def: "@default" },
    ]);
  });

  it("derives an asyncMultiEnum for a string-array field carrying optionsKey", () => {
    const schema = z.object({
      spaceIds: z.array(z.string()).default([]).meta({ optionsKey: "gws.chatSpaces" }).describe("Spaces"),
    });
    expect(describeSchema(schema)).toEqual([
      { key: "spaceIds", label: "Spaces", kind: "asyncMultiEnum", optionsKey: "gws.chatSpaces", def: [] },
    ]);
  });
});
