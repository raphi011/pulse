import { FiClock } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { POMODORO_TYPE } from "./manifest";
import { PomodoroWidget } from "./widgets/pomodoro-widget";

registerRender(POMODORO_TYPE, {
  Component: PomodoroWidget,
  icon: { Icon: FiClock, className: "text-slate-500 dark:text-slate-400" },
});
