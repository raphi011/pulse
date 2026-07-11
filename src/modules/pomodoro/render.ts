import { FiClock } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { pomodoroManifest } from "./manifest";
import { PomodoroWidget } from "./widgets/pomodoro-widget";

registerRender(pomodoroManifest, {
  Component: PomodoroWidget,
  icon: { Icon: FiClock, className: "text-slate-500 dark:text-slate-400" },
});
