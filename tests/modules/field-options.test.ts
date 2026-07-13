import { describe, it, expect, beforeEach } from "vitest";
import {
  registerFieldOptions,
  getFieldOptionsProvider,
  __clearFieldOptionsRegistry,
  type FieldOption,
} from "@/modules/field-options";

beforeEach(() => __clearFieldOptionsRegistry());

describe("field-options registry", () => {
  it("registers and resolves a provider by key", async () => {
    const opts: FieldOption[] = [{ value: "a", label: "A" }];
    registerFieldOptions("k", async () => opts);
    const provider = getFieldOptionsProvider("k");
    expect(provider).toBeTypeOf("function");
    await expect(provider!()).resolves.toEqual(opts);
  });

  it("returns undefined for an unknown key", () => {
    expect(getFieldOptionsProvider("missing")).toBeUndefined();
  });

  it("throws when the same key is registered twice", () => {
    registerFieldOptions("dup", async () => []);
    expect(() => registerFieldOptions("dup", async () => [])).toThrow(/already registered/);
  });
});
