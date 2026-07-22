"use client";
import { useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import {
  filterTasksByAge,
  sortTasks,
  type TasksData,
  type TasksConfig,
  type TaskItem,
} from "../manifest";
import { Gws } from "@/lib/backend";
import { useToast } from "@/components/toast-context";

const setTaskCompleted = (tasklist: string, taskId: string, completed: boolean) =>
  Gws.SetTaskCompleted(tasklist, taskId, completed);

// Google Tasks due dates are date-only at UTC midnight — format in UTC to avoid a day shift.
function dueLabel(due: string): string {
  return new Date(due).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
}

function TaskRow({
  t,
  pending,
  onToggle,
}: {
  t: TaskItem;
  pending: boolean;
  onToggle: (t: TaskItem) => void;
}) {
  return (
    <li className={`py-2 ${pending ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => onToggle(t)}
          aria-label={t.completed ? `Mark "${t.title}" incomplete` : `Mark "${t.title}" complete`}
          className={`shrink-0 text-[0.9rem] leading-none transition-colors disabled:opacity-50 ${
            t.completed ? "text-ok" : "text-slate-400 hover:text-ok dark:text-slate-500"
          }`}
        >
          {t.completed ? "✓" : "○"}
        </button>
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className={`min-w-0 flex-1 truncate text-sm hover:underline ${
            t.completed ? "text-slate-400 line-through dark:text-slate-500" : ""
          }`}
        >
          {t.title}
        </a>
        {t.due && (
          <span className="shrink-0 text-[0.6875rem] tabular-nums text-slate-500 dark:text-slate-400">
            {dueLabel(t.due)}
          </span>
        )}
      </div>
      {t.notes && (
        <p className="mt-0.5 truncate pl-[1.4rem] text-[0.6875rem] text-slate-400 dark:text-slate-500">
          {t.notes}
        </p>
      )}
    </li>
  );
}

export function TasksWidget({ data, config, refresh }: WidgetBodyProps<TasksData, TasksConfig>) {
  // While a toggle is in flight the row is disabled and dimmed. Completion is never
  // changed optimistically — it updates only when refresh() brings server-confirmed
  // data, so a rejected toggle (e.g. read-only Tasks scope) leaves the row untouched
  // and surfaces an error toast.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  async function toggle(t: TaskItem) {
    const next = !t.completed;
    setPending((p) => ({ ...p, [t.id]: true }));
    try {
      await setTaskCompleted(config.tasklist, t.id, next);
      await refresh(); // the row's new state comes only from server data
    } catch (err) {
      const message = err instanceof Error ? err.message : "please try again.";
      toast(`Couldn't update task: ${message}`, "error");
    } finally {
      setPending((p) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
        const { [t.id]: _drop, ...rest } = p;
        return rest;
      });
    }
  }

  const visible = sortTasks(filterTasksByAge(data.tasks, config.completedMaxAge, new Date()));

  if (visible.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No tasks.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {visible.map((t) => (
        <TaskRow key={t.id} t={t} pending={Boolean(pending[t.id])} onToggle={toggle} />
      ))}
    </ul>
  );
}
