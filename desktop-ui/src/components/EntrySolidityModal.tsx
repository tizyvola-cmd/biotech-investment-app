import { useMemo } from "react";
import type { Top2PickSignal } from "../sheet/top2PortfolioPick";
import type { SimulationSolidityResult } from "../sheet/simulationEntrySolidity";
import {
  SOLIDITY_COMPONENT_COLORS,
  type SolidityCompositeComponentId,
} from "../sheet/entrySolidityComposite";
import { groupSolidityFailures } from "../sheet/solidityFailureBuckets";
import {
  SCORE_COMPONENT_MAX,
  scoreContributionTone,
  type ScoreBreakdown,
} from "../sheet/investSignalScore";
import { useLang, useT } from "../shared/i18n";
import type { TranslationKey } from "../shared/i18n";
import type { StrictPickFailure } from "../sheet/topOppsStrictPick";
import { formatFailureLine } from "./SimulationSolidityBadge";
import { SolidityCompositePieChart } from "./SolidityPieIcon";
import { AppModal, AppModalCloseButton } from "./AppModal";

const COMPONENT_LABEL_KEYS: Record<SolidityCompositeComponentId, TranslationKey> = {
  reliability: "sim.solidity.composite.reliability",
  timing: "sim.solidity.composite.timing",
  align: "sim.solidity.composite.align",
  roi_target: "sim.solidity.composite.roiTarget",
  sds: "sim.solidity.composite.sds",
  precat: "sim.solidity.composite.precat",
  mii: "sim.solidity.composite.mii",
  calib: "sim.solidity.composite.calib",
  momentum_accel: "sim.solidity.composite.momentum_accel",
};



const TIER_LABEL_KEYS: Record<SimulationSolidityResult["composite"]["tier"], TranslationKey> = {

  top: "sim.solidity.composite.tierTop",

  strong: "sim.solidity.composite.tierStrong",

  watch: "sim.solidity.composite.tierWatch",

  weak: "sim.solidity.composite.tierWeak",

};



function toneBarClass(tone: "good" | "warn" | "bad" | "neutral"): string {

  switch (tone) {

    case "good":

      return "bg-emerald-500/85";

    case "warn":

      return "bg-amber-500/85";

    case "bad":

      return "bg-red-500/85";

    default:

      return "bg-slate-400/70";

  }

}



function CompositeComponentRow({

  label,

  comp,

  breakdown,

  lang,

}: {

  label: string;

  comp: SimulationSolidityResult["composite"]["components"][number];

  breakdown: ScoreBreakdown | null;

  lang: "it" | "en";

}) {

  const scorePct = comp.maxPoints > 0 ? Math.min(100, (comp.points / comp.maxPoints) * 100) : 0;
  const pct =
    comp.visualFillPct != null && comp.visualFillPct > scorePct
      ? comp.visualFillPct
      : scorePct;

  const color = SOLIDITY_COMPONENT_COLORS[comp.id];



  return (

    <div className="rounded-lg border border-slate-200/80 dark:border-slate-700 px-3 py-2 space-y-1.5">

      <div className="flex items-center justify-between gap-2">

        <div className="flex items-center gap-2 min-w-0">

          <span

            className="shrink-0 w-2 h-2 rounded-full"

            style={{ backgroundColor: color }}

            aria-hidden

          />

          <span className="text-[11px] font-semibold truncate">{label}</span>

        </div>

        <span className={`text-[11px] tabular-nums font-medium ${scoreContributionTone(comp.points, comp.maxPoints)}`}>

          {comp.points.toFixed(comp.points % 1 === 0 ? 0 : 1)} / {comp.maxPoints}

        </span>

      </div>

      <div className="h-1.5 rounded-full bg-slate-200/80 overflow-hidden">

        <div

          className={`h-full rounded-full transition-all ${toneBarClass(comp.tone)}`}

          style={{ width: `${pct}%`, backgroundColor: pct > 0 ? color : undefined }}

        />

      </div>

      <p className="text-[10px] text-ink-muted leading-snug">{comp.detail}</p>

      {comp.id === "reliability" && breakdown ? (

        <details className="text-[10px] text-ink-muted pt-0.5">

          <summary className="cursor-pointer select-none hover:text-ink/80">

            {lang === "it" ? "Dettaglio Score Reliability (6 componenti)" : "Score Reliability breakdown (6 parts)"}

          </summary>

          <ul className="mt-1 space-y-0.5 pl-2 border-l border-slate-200 dark:border-slate-700 ml-0.5">

            <li>Conf {breakdown.affidScore}/{SCORE_COMPONENT_MAX.affid}</li>

            <li>R² {breakdown.r2Score}/{SCORE_COMPONENT_MAX.r2}</li>

            <li>Timing {breakdown.timingScore}/{SCORE_COMPONENT_MAX.timing}</li>

            <li>Align {breakdown.slopeAlign}/{SCORE_COMPONENT_MAX.align}</li>

            <li>Pred {breakdown.predScore}/{SCORE_COMPONENT_MAX.pred}</li>

            <li>Gap {breakdown.accuracyScore}/{SCORE_COMPONENT_MAX.accuracy}</li>

          </ul>

        </details>

      ) : null}

    </div>

  );

}



function FailureBucket({

  title,

  tone,

  items,

  tr,

}: {

  title: string;

  tone: "neutral" | "warn" | "danger";

  items: StrictPickFailure[];

  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string;

}) {

  if (items.length === 0) return null;

  const border =

    tone === "danger"

      ? "border-amber-400/50 bg-amber-500/8"

      : tone === "warn"

        ? "border-slate-400/35 bg-slate-500/6"

        : "border-emerald-400/35 bg-emerald-500/6";

  return (

    <div className={`rounded-lg border px-3 py-2 ${border}`}>

      <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5 opacity-90">{title}</p>

      <ul className="space-y-1 text-[11px] leading-snug">

        {items.map((f, i) => (

          <li key={`${f.code}-${i}`} className="flex gap-1.5">

            <span className="opacity-60 shrink-0">·</span>

            <span>{formatFailureLine(f, tr)}</span>

          </li>

        ))}

      </ul>

    </div>

  );

}



export function EntrySolidityModal({

  open,

  onClose,

  ticker,

  cd,

  daysToCd,

  pick,

  result,

  breakdown,

}: {

  open: boolean;

  onClose: () => void;

  ticker: string;

  cd: string;

  daysToCd: number | null;

  pick: Top2PickSignal | null;

  result: SimulationSolidityResult;

  breakdown: ScoreBreakdown | null;

}) {

  const t = useT();

  const { lang } = useLang();



  const grouped = useMemo(

    () => groupSolidityFailures(result.failures, daysToCd),

    [result.failures, daysToCd],

  );



  const tierLabel = t(TIER_LABEL_KEYS[result.composite.tier]);



  const statusLabel =

    result.level === "blocked"

      ? t("sim.solidity.badge.blocked")

      : result.level === "caution"

        ? t("sim.solidity.badge.caution")

        : t("sim.solidity.composite.top");



  if (!open) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-labelledby="entry-solidity-title"
      panelClassName="w-full max-w-lg flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
    >
      <div className="flex items-start gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-700 shrink-0">

          <div className="shrink-0 pt-0.5">

            <SolidityCompositePieChart composite={result.composite} size={56} />

          </div>

          <div className="flex-1 min-w-0">

            <h2 id="entry-solidity-title" className="text-base font-bold">

              {t("sim.solidity.modal.title", { ticker })}

            </h2>

            <p className="text-[11px] text-ink-muted mt-0.5">

              CD {cd}

              {daysToCd != null ? ` · T−${daysToCd}d` : ""}

            </p>

            <p className="text-[11px] font-semibold mt-1">

              {result.composite.total}/100 · {tierLabel}

              {result.level !== "ok" ? ` · ${statusLabel}` : ""}

            </p>

          </div>

          <AppModalCloseButton onClose={onClose} />

        </div>



        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">

          <section>

            <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-2">

              {t("sim.solidity.composite.section")}

            </h3>

            <p className="text-[10px] text-ink-muted mb-2 leading-snug">

              {t("sim.solidity.composite.sectionHint")}

            </p>

            <SolidityCompositePieChart

              composite={result.composite}

              size={148}

              label={tierLabel}

            />

          </section>



          <section className="space-y-2">

            <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">

              {t("sim.solidity.composite.breakdownSection")}

            </h3>

            {result.composite.components.map((comp) => (

              <CompositeComponentRow

                key={comp.id}

                label={t(COMPONENT_LABEL_KEYS[comp.id])}

                comp={comp}

                breakdown={comp.id === "reliability" ? breakdown : null}

                lang={lang}

              />

            ))}

          </section>



          {result.failures.length > 0 ? (

            <section>

              <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-2">

                {t("sim.solidity.modal.entrySection")}

              </h3>

              <div className="space-y-2">

                <FailureBucket

                  title={t("sim.solidity.modal.bucketExpected")}

                  tone="neutral"

                  items={grouped.expected}

                  tr={t}

                />

                <FailureBucket

                  title={t("sim.solidity.modal.bucketMonitor")}

                  tone="warn"

                  items={grouped.monitor}

                  tr={t}

                />

                <FailureBucket

                  title={t("sim.solidity.modal.bucketBlock")}

                  tone="danger"

                  items={grouped.block}

                  tr={t}

                />

              </div>

            </section>

          ) : (

            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">

              {t("sim.solidity.modal.allPass")}

            </p>

          )}



          {pick?.precatLabel ? (

            <p className="text-[10px] text-ink-muted border-t border-slate-100 dark:border-slate-800 pt-2">

              Precat: {pick.precatLabel}

              {pick.precatOriginalKind && pick.precatOriginalKind !== pick.precatKind

                ? ` → ${pick.precatKind}`

                : ""}

            </p>

          ) : null}

        </div>
    </AppModal>
  );

}


