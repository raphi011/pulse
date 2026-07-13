import type { WidgetBodyProps } from "@/modules/contracts";
import type { PomodoroConfig, PomodoroData } from "../manifest";
import { pomodoroEngine, type PomodoroPhase, type PomodoroSnapshot } from "../engine";
import { usePomodoro } from "../use-pomodoro";
import { Ring } from "@/components/ring";

type Props = WidgetBodyProps<PomodoroData, PomodoroConfig>;

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  work: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

/** Work is indigo (the app accent); breaks are teal so the phase reads at a glance. */
const PHASE_COLOR: Record<PomodoroPhase, string> = {
  work: "var(--color-primary-500)",
  shortBreak: "#14b8a6",
  longBreak: "#14b8a6",
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
    <span className="mt-0.5 flex items-center gap-1" title={`${count} pomodoros completed today`}>
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
  const finished = snap.status === "finished";
  const isBreak = snap.phase !== "work";

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Ring progress={progress} color={PHASE_COLOR[snap.phase]}>
          <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-slate-800 dark:text-slate-100">
            {formatRemaining(snap.remainingMs)}
          </span>
          <span
            className="text-[0.625rem] font-semibold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400"
            style={finished ? { color: "var(--color-warn)" } : isBreak ? { color: PHASE_COLOR[snap.phase] } : undefined}
          >
            {finished ? "Time's up" : PHASE_LABEL[snap.phase]}
          </span>
          <CompletedDots count={snap.completedToday} />
        </Ring>
      </div>

      {/* Controls stay out of the way until the card is hovered or focused. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-1.5 justify-center gap-2 bg-gradient-to-t from-card via-card to-transparent px-3 pb-2 pt-8 opacity-0 transition-[opacity,transform] duration-150 ease-out focus-within:pointer-events-auto focus-within:translate-y-0 focus-within:opacity-100 group-hover/card:pointer-events-auto group-hover/card:translate-y-0 group-hover/card:opacity-100 dark:from-card-dark dark:via-card-dark">
        {controls(snap).map((b) => (
          <button
            key={b.label}
            onClick={b.action}
            className={
              b.primary
                ? "rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-500"
                : "rounded-lg bg-slate-100 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      {snap.notifyBlocked && (
        <p className="shrink-0 pt-1 text-center text-xs text-slate-500 dark:text-slate-400">
          Notifications blocked — enable them for this app in System Settings.
        </p>
      )}
    </div>
  );
}
