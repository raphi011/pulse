import type { WidgetBodyProps } from "@/modules/contracts";
import type { PomodoroConfig, PomodoroData } from "../manifest";
import { pomodoroEngine, type PomodoroPhase, type PomodoroSnapshot } from "../engine";
import { usePomodoro } from "../use-pomodoro";

type Props = WidgetBodyProps<PomodoroData, PomodoroConfig>;

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  work: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CompletedDots({ count }: { count: number }) {
  if (count === 0) return null;
  const dots = Math.min(count, 8);
  return (
    <span className="flex items-center gap-1" title={`${count} pomodoros completed today`}>
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-primary-500" />
      ))}
      {count > dots && <span className="text-xs text-slate-500 dark:text-slate-400">+{count - dots}</span>}
    </span>
  );
}

function controls(snap: PomodoroSnapshot): { label: string; action: () => void; primary?: boolean }[] {
  const buttons: { label: string; action: () => void; primary?: boolean }[] = [];
  if (snap.status === "running") {
    buttons.push({ label: "Pause", action: pomodoroEngine.pause, primary: true });
  } else {
    buttons.push({ label: snap.status === "paused" ? "Resume" : "Start", action: pomodoroEngine.start, primary: true });
  }
  if (snap.status === "running" || snap.status === "paused") {
    buttons.push({ label: "Reset", action: pomodoroEngine.reset });
  }
  if (snap.phase !== "work") {
    buttons.push({ label: "Skip break", action: pomodoroEngine.skip });
  }
  return buttons;
}

export function PomodoroWidget({ config }: Props) {
  const snap = usePomodoro(config);
  const progress = snap.durationMs > 0 ? 1 - snap.remainingMs / snap.durationMs : 0;

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>{PHASE_LABEL[snap.phase]}</span>
        {snap.status === "finished" && <span className="text-warn">— time's up</span>}
      </div>

      <div className="font-mono text-4xl tabular-nums text-slate-800 dark:text-slate-100">
        {formatRemaining(snap.remainingMs)}
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-primary-500 transition-[width]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="flex items-center gap-2">
        {controls(snap).map((b) => (
          <button
            key={b.label}
            onClick={b.action}
            className={
              b.primary
                ? "rounded-md bg-primary-600 px-3 py-1 text-sm font-medium text-white hover:bg-primary-500"
                : "rounded-md px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      <CompletedDots count={snap.completedToday} />

      {snap.notifyBlocked && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Notifications blocked — enable them for this app in System Settings.
        </p>
      )}
    </div>
  );
}
