import { gwsJson } from "./gws";
import type { TasksConfig, TasksData, TaskItem } from "./manifest";

type GTask = {
  id: string;
  title?: string;
  notes?: string;
  status?: string; // "needsAction" | "completed"
  due?: string;
  completed?: string; // RFC3339 timestamp, present only on completed tasks
  webViewLink?: string;
};
type TasksResp = { items?: GTask[] };

export function normalizeTask(t: GTask): TaskItem {
  return {
    id: t.id,
    title: t.title || "(no title)",
    notes: t.notes,
    due: t.due ?? "",
    completed: t.status === "completed",
    completedAt: t.completed ?? "",
    url: t.webViewLink ?? "",
  };
}

export async function fetchTasks(config: TasksConfig): Promise<TasksData> {
  const resp = await gwsJson<TasksResp>([
    "tasks", "tasks", "list",
    "--params", JSON.stringify({
      tasklist: config.tasklist,
      maxResults: config.limit,
      showCompleted: config.showCompleted,
      showHidden: config.showCompleted, // completed tasks are hidden by default
    }),
  ]);
  // The API returns items in manual (`position`) order — preserve it.
  const tasks = (resp.items ?? []).map(normalizeTask);
  return { tasks };
}

/**
 * Flip a task's completion via `gws tasks tasks patch`. Un-completing sends
 * `completed: null` so the timestamp clears under patch semantics.
 */
export async function setTaskCompleted(
  tasklist: string,
  taskId: string,
  completed: boolean,
): Promise<void> {
  const body = completed
    ? { status: "completed" }
    : { status: "needsAction", completed: null };
  await gwsJson<GTask>([
    "tasks", "tasks", "patch",
    "--params", JSON.stringify({ tasklist, task: taskId }),
    "--json", JSON.stringify(body),
  ]);
}
