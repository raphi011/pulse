import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@/lib/backend", () => ({
  Gws: { SetTaskCompleted: vi.fn().mockResolvedValue(undefined) },
}));
import { Gws } from "@/lib/backend";
import { TasksWidget } from "@/modules/gws/widgets/tasks-widget";
import { ToastProvider } from "@/components/toast-context";
import type { TaskItem, TasksConfig } from "@/modules/gws/manifest";

const tasksDefaultConfig: TasksConfig = {
  tasklist: "@default",
  showCompleted: false,
  completedMaxAge: "All time",
  limit: 25,
};

const mockSet = Gws.SetTaskCompleted as unknown as ReturnType<typeof vi.fn>;

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
    <ToastProvider>
      <TasksWidget
        data={{ tasks }}
        config={{ ...tasksDefaultConfig, showCompleted: true }}
        refresh={refresh}
      />
    </ToastProvider>,
  );
  return { refresh };
}

beforeEach(() => {
  mockSet.mockReset();
  mockSet.mockResolvedValue(undefined);
});

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

  it("does not flip optimistically; updates only after the CLI resolves + refresh", async () => {
    let resolveSet: () => void = () => {};
    mockSet.mockImplementationOnce(() => new Promise<void>((r) => { resolveSet = () => r(); }));
    const { refresh } = renderWidget([task("todo", false)]);
    const btn = screen.getByRole("button", { name: 'Mark "todo" complete' });
    await act(async () => {
      btn.click();
    });
    // In flight: no optimistic flip, button disabled, refresh not yet called.
    expect(btn.textContent).toBe("○");
    expect(btn).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      resolveSet();
    });
    expect(mockSet).toHaveBeenCalledWith("@default", "todo", true);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an error toast and does not refresh when the toggle fails", async () => {
    mockSet.mockRejectedValueOnce(
      new Error("Request had insufficient authentication scopes."),
    );
    const { refresh } = renderWidget([task("todo", false)]);
    const btn = screen.getByRole("button", { name: 'Mark "todo" complete' });
    await act(async () => {
      btn.click();
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't update task: Request had insufficient authentication scopes.",
    );
  });
});
