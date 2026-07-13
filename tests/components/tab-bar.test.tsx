import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { TabBar } from "@/components/tab-bar";
import type { Tab } from "@/server/tabs-repo";

const tabs: Tab[] = [
  { id: "t1", name: "Work", order: 0 },
  { id: "t2", name: "Personal", order: 1 },
];

function renderBar(props: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  const merged = {
    tabs, activeTabId: "t1", autoEditId: null,
    onSelect: vi.fn(), onAdd: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(),
    canDelete: true, ...props,
  };
  render(<DndContext>{<TabBar {...merged} />}</DndContext>);
  return merged;
}

describe("TabBar", () => {
  it("selects a tab on click", () => {
    const p = renderBar();
    fireEvent.click(screen.getByText("Personal"));
    expect(p.onSelect).toHaveBeenCalledWith("t2");
  });

  it("adds a tab", () => {
    const p = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /add tab/i }));
    expect(p.onAdd).toHaveBeenCalledOnce();
  });

  it("renames on double-click + Enter", () => {
    const p = renderBar();
    fireEvent.doubleClick(screen.getByText("Work"));
    const input = screen.getByDisplayValue("Work");
    fireEvent.change(input, { target: { value: "Focus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onRename).toHaveBeenCalledWith("t1", "Focus");
  });

  it("shows delete only for the active tab when canDelete", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /delete tab/i })).toBeInTheDocument();
  });

  it("hides delete when only one tab remains", () => {
    renderBar({ tabs: [tabs[0]], canDelete: false });
    expect(screen.queryByRole("button", { name: /delete tab/i })).toBeNull();
  });
});
