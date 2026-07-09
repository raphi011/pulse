import { describe, it, expect } from "vitest";
import { findColumn, moveWidget, toPositions, type Columns } from "@/lib/layout";

const cols: Columns = [["a", "b"], ["c"], []];

describe("layout reducer", () => {
  it("finds the column of a widget", () => {
    expect(findColumn(cols, "c")).toBe(1);
    expect(findColumn(cols, "z")).toBe(-1);
  });

  it("reorders within a column", () => {
    expect(moveWidget(cols, "a", 0, 1)).toEqual([["b", "a"], ["c"], []]);
  });

  it("moves across columns at an index", () => {
    expect(moveWidget(cols, "a", 2, 0)).toEqual([["b"], ["c"], ["a"]]);
  });

  it("clamps the target index to column length", () => {
    expect(moveWidget(cols, "c", 0, 99)).toEqual([["a", "b", "c"], [], []]);
  });

  it("serializes to positions", () => {
    expect(toPositions([["b", "a"], ["c"]])).toEqual([
      { id: "b", column: 0, order: 0 },
      { id: "a", column: 0, order: 1 },
      { id: "c", column: 1, order: 0 },
    ]);
  });
});
