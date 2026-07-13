import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TasksWidget } from "@/modules/gws/widgets/tasks-widget";
import { tasksDefaultConfig, type TaskItem } from "@/modules/gws/manifest";
import { setTaskCompleted } from "@/modules/gws/tasks";

vi.mock("@/modules/gws/tasks", () => ({ setTaskCompleted: vi.fn().mockResolvedValue(undefined) }));
const mockSet = setTaskCompleted as unknown as ReturnType<typeof vi.fn>;

const task = (id: string, completed: boolean): TaskItem => ({
  id,
  title: id,
  due: "",
  completed,
  completedAt: completed ? "2026-07-13T09:00:00.000Z" : "",
  url: `https://tasks/${id}`,
});

function renderWidget(tasks: TaskItem[]) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <TasksWidget
      data={{ tasks }}
      config={{ ...tasksDefaultConfig, showCompleted: true }}
      refresh={refresh}
    />,
  );
  return { refresh };
}

beforeEach(() => mockSet.mockClear());

describe("TasksWidget", () => {
  it("shows an empty message when there are no tasks", () => {
    renderWidget([]);
    expect(screen.getByText("No tasks.")).toBeInTheDocument();
  });

  it("renders incomplete tasks before completed ones", () => {
    renderWidget([task("done", true), task("todo", false)]);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["todo", "done"]);
  });

  it("optimistically completes a task, then syncs via CLI + refresh", async () => {
    const { refresh } = renderWidget([task("todo", false)]);
    const btn = screen.getByRole("button", { name: 'Mark "todo" complete' });
    await act(async () => {
      btn.click();
    });
    expect(mockSet).toHaveBeenCalledWith("@default", "todo", true);
    expect(refresh).toHaveBeenCalled();
  });
});
