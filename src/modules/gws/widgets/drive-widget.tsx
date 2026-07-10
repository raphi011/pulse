"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import { filterDriveFiles, type DriveData, type DriveConfig } from "../manifest";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function DriveWidget({ data, config }: WidgetBodyProps<DriveData, DriveConfig>) {
  const files = filterDriveFiles(data.files, config);
  if (files.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No starred files.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2.5 py-2">
          {f.iconLink ? (
            // eslint-disable-next-line @next/next/no-img-element -- local single-user app; Google's static icon host, matches existing plain-element widgets
            <img src={f.iconLink.replace("/16/", "/32/")} alt="" className="h-4 w-4 shrink-0" />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
          )}
          <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
            <span className="block truncate text-sm">{f.name}</span>
          </a>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {shortDate(f.modifiedTime)}
          </span>
        </li>
      ))}
    </ul>
  );
}
