import { useEffect, useMemo, useState } from "react";
import type { DecisionSimState } from "../sheet/investDecisionSimLoop";
import { describeDecisionSimTickSchedule } from "../sheet/decisionSimTickScheduleView";
import { useLang, useT } from "../shared/i18n";

function statusClass(status: ReturnType<typeof describeDecisionSimTickSchedule>["status"]): string {
  if (status === "due_now") {
    return "border-emerald-400/55 bg-emerald-50/90 text-emerald-900 dark:border-emerald-600/45 dark:bg-emerald-950/35 dark:text-emerald-100";
  }
  if (status === "disabled") {
    return "border-slate-300/60 bg-slate-50/80 text-slate-600 dark:border-slate-600/45 dark:bg-slate-900/35 dark:text-slate-300";
  }
  if (status === "outside_window") {
    return "border-amber-300/55 bg-amber-50/85 text-amber-900 dark:border-amber-700/45 dark:bg-amber-950/30 dark:text-amber-100";
  }
  return "border-indigo-300/50 bg-indigo-50/80 text-indigo-900 dark:border-indigo-600/40 dark:bg-indigo-950/30 dark:text-indigo-100";
}

export function PulseSimTickScheduleStrip({ state }: { state: DecisionSimState }) {
  const t = useT();
  const { lang } = useLang();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const view = useMemo(
    () => describeDecisionSimTickSchedule(state, now, lang),
    [state, now, lang],
  );

  const statusLabel =
    view.status === "due_now"
      ? t("dashboard.pulse.tickSchedule.statusDue")
      : view.status === "disabled"
        ? t("dashboard.pulse.tickSchedule.statusOff")
        : view.status === "outside_window"
          ? t("dashboard.pulse.tickSchedule.statusClosed")
          : t("dashboard.pulse.tickSchedule.statusWaiting");

  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 text-[10px] leading-snug tabular-nums ${statusClass(view.status)}`}
      title={view.scheduleCaption}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-semibold uppercase tracking-wide">{statusLabel}</span>
        <span className="opacity-75">·</span>
        <span>
          {view.lastTickLabel
            ? `${t("dashboard.pulse.tickSchedule.lastTick")}: ${view.lastTickLabel}`
            : t("dashboard.pulse.tickSchedule.noTickYet")}
        </span>
        {view.enabled && view.nextSlotLabel ? (
          <>
            <span className="opacity-75">·</span>
            <span>
              {view.status === "due_now"
                ? t("dashboard.pulse.tickSchedule.slotOpen", { slot: view.nextSlotLabel })
                : t("dashboard.pulse.tickSchedule.nextSlot", { slot: view.nextSlotLabel })}
            </span>
          </>
        ) : null}
      </div>
      <p className="mt-0.5 text-[9px] opacity-80 font-medium">{view.scheduleCaption}</p>
    </div>
  );
}
