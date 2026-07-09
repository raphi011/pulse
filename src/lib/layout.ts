export type Columns = string[][];

export function findColumn(cols: Columns, id: string): number {
  return cols.findIndex((col) => col.includes(id));
}

export function moveWidget(cols: Columns, id: string, toCol: number, toIndex: number): Columns {
  const next = cols.map((col) => col.filter((x) => x !== id));
  const target = next[toCol] ?? (next[toCol] = []);
  const index = Math.max(0, Math.min(toIndex, target.length));
  target.splice(index, 0, id);
  return next;
}

export function toPositions(cols: Columns): { id: string; column: number; order: number }[] {
  return cols.flatMap((col, column) => col.map((id, order) => ({ id, column, order })));
}
