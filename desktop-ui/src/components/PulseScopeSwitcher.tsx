import type { ReactNode } from "react";
import { PortfolioBriefcaseMark } from "./PortfolioScopeToggle";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { useLang, useT } from "../shared/i18n";

/** Three independent pulse sessions — portfolio, equal sim loop, synth sim loop. */
export type PulseScope = "portfolio" | "simLoop" | "simLoopSynth";

export function PulseScopeSwitcher({
  active,
  onSelect,
}: {
  active: PulseScope;
  onSelect: (scope: PulseScope) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const items: {
    id: PulseScope;
    label: ReactNode;
    tip: string;
    className?: string;
    activeClassName?: string;
  }[] = [
    {
      id: "portfolio",
      label: (
        <>
          <PortfolioBriefcaseMark
            title={t("sim.lossAnalysis.summaryTable.portfolioMark")}
            className="text-[10px] mr-0.5"
          />
          {it ? "Portfolio" : "Portfolio"}
        </>
      ),
      tip: it
        ? "P&L e avanzamento sul portafoglio reale (Simulation con capitale > 0)."
        : "P&L and progress on the real portfolio (Simulation rows with capital > 0).",
    },
    {
      id: "simLoop",
      label: it ? "Sim loop" : "Sim loop",
      tip: it
        ? "Stesso pannello sul paper sim loop — € uguali per deal (es. €5k)."
        : "Same panel on the paper sim loop — equal € per deal (e.g. €5k).",
    },
    {
      id: "simLoopSynth",
      label: t("dashboard.pulse.simLoopSynth.switchLabel"),
      tip: t("dashboard.pulse.simLoopSynth.switchTip"),
      className:
        "border-pink-300/70 text-pink-900/90 dark:border-pink-700/50 dark:text-pink-100",
      activeClassName:
        "border-pink-500 bg-pink-50 text-pink-950 dark:border-pink-500 dark:bg-pink-950/50 dark:text-pink-50",
    },
  ];

  return (
    <SelectionChipGroup className="justify-end">
      {items.map(({ id, label, tip, className, activeClassName }) => {
        const isActive = active === id;
        return (
          <SelectionChip
            key={id}
            active={isActive}
            title={tip}
            aria-pressed={isActive}
            onClick={() => {
              if (id !== active) onSelect(id);
            }}
            className={
              isActive && activeClassName
                ? activeClassName
                : !isActive && className
                  ? className
                  : undefined
            }
          >
            {label}
          </SelectionChip>
        );
      })}
    </SelectionChipGroup>
  );
}
