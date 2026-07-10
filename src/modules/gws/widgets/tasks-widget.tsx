"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { TasksData, TasksConfig, TaskItem } from "../manifest";

// Google Tasks due dates are date-only at UTC midnight — format in UTC to avoid a day shift.
function dueLabel(due: string): string {
  return new Date(due).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
}

function TaskRow({ t }: { t: TaskItem }) {
  return (
    <li className="py-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={`shrink-0 text-[0.9rem] leading-none ${t.completed ? "text-ok" : "text-slate-400 dark:text-slate-500"}`}
        >
          {t.completed ? "✓" : "○"}
        </span>
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

export function TasksWidget({ data }: WidgetBodyProps<TasksData, TasksConfig>) {
  if (data.tasks.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No tasks.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.tasks.map((t) => (
        <TaskRow key={t.id} t={t} />
      ))}
    </ul>
  );
}
