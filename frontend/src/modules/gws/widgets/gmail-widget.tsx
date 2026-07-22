"use client";
import { useState } from "react";
import { FiArchive, FiCheck, FiTrash2 } from "react-icons/fi";
import type { IconType } from "react-icons";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { GmailData, GmailConfig, EmailItem } from "../manifest";
import { Gws } from "@/lib/backend";
import { useToast } from "@/components/toast-context";
import { PartialFailure } from "@/components/partial-failure";

const archiveEmail = (id: string) => Gws.ArchiveEmail(id);
const markEmailRead = (id: string) => Gws.MarkEmailRead(id);
const trashEmail = (id: string) => Gws.TrashEmail(id);

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type RowAction = { verb: string; label: string; Icon: IconType; run: () => Promise<void>; danger?: boolean };

/** Actions for one row. Mark-as-read only appears while the email is unread. */
function rowActions(m: EmailItem): RowAction[] {
  const actions: RowAction[] = [
    { verb: "archive", label: `Archive email from ${m.from}`, Icon: FiArchive, run: () => archiveEmail(m.id) },
  ];
  if (m.unread) {
    actions.push({ verb: "mark read", label: `Mark email from ${m.from} as read`, Icon: FiCheck, run: () => markEmailRead(m.id) });
  }
  actions.push({ verb: "trash", label: `Trash email from ${m.from}`, Icon: FiTrash2, run: () => trashEmail(m.id), danger: true });
  return actions;
}

export function GmailWidget({ data, refresh }: WidgetBodyProps<GmailData, GmailConfig>) {
  // Non-optimistic: the row is dimmed + disabled while a mutation is in flight, and
  // leaves the list only when refresh() brings server-confirmed data. A rejected
  // action leaves the row untouched and surfaces an error toast.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  async function perform(m: EmailItem, action: RowAction) {
    setPending((p) => ({ ...p, [m.id]: true }));
    try {
      await action.run();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "please try again.";
      toast(`Couldn't ${action.verb} email: ${message}`, "error");
    } finally {
      setPending((p) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
        const { [m.id]: _drop, ...rest } = p;
        return rest;
      });
    }
  }

  const errors = data.errors ?? [];

  if (data.emails.length === 0)
    return errors.length ? (
      <PartialFailure items={errors} noun="email" />
    ) : (
      <p className="text-sm text-slate-500 dark:text-slate-400">No emails.</p>
    );

  return (
    <>
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.emails.map((m) => {
        const busy = Boolean(pending[m.id]);
        return (
          <li
            key={m.id}
            className={`group/mailrow relative flex items-center gap-2.5 py-2 transition-opacity ${busy ? "opacity-60" : ""}`}
          >
            <span
              aria-label={m.unread ? "unread" : "read"}
              className={`h-2 w-2 shrink-0 rounded-full ${m.unread ? "bg-primary-500" : "bg-transparent"}`}
            />
            <a href={m.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
              <span className="block truncate text-sm">{m.subject}</span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{m.from}</span>
            </a>
            <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{shortDate(m.date)}</span>

            {/* Actions overlay the date, revealed on row hover/focus. */}
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-gradient-to-l from-card via-card to-transparent pl-8 opacity-0 transition-opacity duration-150 ease-out focus-within:pointer-events-auto focus-within:opacity-100 group-hover/mailrow:pointer-events-auto group-hover/mailrow:opacity-100 dark:from-card-dark dark:via-card-dark">
              {rowActions(m).map((a) => (
                <button
                  key={a.verb}
                  type="button"
                  disabled={busy}
                  onClick={() => perform(m, a)}
                  title={a.label}
                  aria-label={a.label}
                  className={`grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-white/10 ${
                    a.danger ? "hover:text-danger" : "hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                >
                  <a.Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
    {errors.length > 0 && <PartialFailure items={errors} noun="email" />}
    </>
  );
}
