import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SlopeVerdictContext } from "../sheet/slopeVerdictContext";
import {
  flatSlopeVerdictSummary,
  risingFlatSlopeVerdictSummary,
  verdictLabel,
  verdictTone,
  type StabilityVerdict,
} from "../sheet/slopeStability";
import {
  slopeVerdictDisagreesWithFinalAction,
  suggestedActionDisplayLabel,
} from "../sheet/slopeVerdictAction";
import { useLang, useT } from "../shared/i18n";
import { SlopeVerdictPill, slopeVerdictBannerClasses, slopeVerdictToneClasses } from "./SlopeVerdictPill";

function slopeVerdictKeywordClass(verdict: StabilityVerdict, curveRisingHold = false): string {
  if (verdict === "none" && curveRisingHold) return "sn-slope-verdict-kw--stay";
  switch (verdict) {
    case "watch":
      return "sn-slope-verdict-kw--watch";
    case "exit":
    case "avoid":
      return "sn-slope-verdict-kw--exit";
    case "entry":
    case "persistent":
      return "sn-slope-verdict-kw--stay";
    default:
      return "";
  }
}

function SlopeVerdictSummaryLine({
  verdict,
  text,
  className,
  curveRisingHold = false,
}: {
  verdict: StabilityVerdict;
  text: string;
  className?: string;
  curveRisingHold?: boolean;
}) {
  const split = text.split(" — ");
  const head = split[0]?.trim() ?? text;
  const tail = split.slice(1).join(" — ");
  const kwCls = slopeVerdictKeywordClass(verdict, curveRisingHold);
  if (!tail) {
    return (
      <p className={className}>
        <span className={`font-bold ${kwCls}`}>{head}</span>
      </p>
    );
  }
  return (
    <p className={className}>
      <span className={`font-bold ${kwCls}`}>{head}</span>
      <span className="text-slate-700"> — {tail}</span>
    </p>
  );
}

export function SlopeVerdictBanner({
  ctx,
  simRow: _simRow,
  simTable: _simTable,
  chartPts: _chartPts,
  sdsRows: _sdsRows,
  variant = "card",
  alwaysShow = false,
  onExecuteExit,
  canExecuteExit = false,
  suggestedAction,
  exitDecision,
}: {
  ctx: SlopeVerdictContext;
  simRow: Record<string, unknown> | null;
  simTable: SheetTable | null;
  chartPts?: ChartPoint[] | null;
  sdsRows?: SdsRow[] | null;
  /** card = full width banner; inline = compact row for signal headers; compact = loss card column beside polygon */
  variant?: "card" | "inline" | "hero" | "compact";
  /** In In Loss mostra anche pendenza piatta (verdetto formale none). */
  alwaysShow?: boolean;
  /** Chiude la posizione (vendita) — pill EXIT quando verdetto exit/avoid. */
  onExecuteExit?: () => void;
  canExecuteExit?: boolean;
  /** Azione finale arbitro (deriveSuggestedAction) — brief P2-B. */
  suggestedAction?: "buy" | "sell" | "hold" | "review" | "none" | null;
  /** Segnale exit layer (info secondaria se diverge da suggestedAction). */
  exitDecision?: "exit" | "hold" | "review" | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const isFlat = ctx.stabilityVerdict === "none";
  if (isFlat && !alwaysShow) return null;

  const risingFlat = isFlat && Boolean(ctx.curveRisingHold);
  const tone = risingFlat ? "positive" : isFlat ? "neutral" : verdictTone(ctx.stabilityVerdict);
  const summaryLabel = isFlat
    ? risingFlat
      ? risingFlatSlopeVerdictSummary(it ? "it" : "en")
      : flatSlopeVerdictSummary(it ? "it" : "en")
    : verdictLabel(ctx.stabilityVerdict);

  const slopeDisagrees =
    suggestedAction != null &&
    slopeVerdictDisagreesWithFinalAction(
      ctx.stabilityVerdict,
      suggestedAction,
      ctx.curveRisingHold,
    );
  const finalActionLabel =
    suggestedAction != null ? suggestedActionDisplayLabel(suggestedAction, it ? "it" : "en") : null;
  const showExitSignalSecondary =
    exitDecision === "exit" &&
    suggestedAction != null &&
    suggestedAction !== "sell" &&
    (suggestedAction === "hold" || suggestedAction === "review" || suggestedAction === "buy");

  const contextNote =
    slopeDisagrees && finalActionLabel
      ? t("sim.lossAnalysis.slopeVerdict.finalActionNote", {
          final: finalActionLabel,
        })
      : showExitSignalSecondary
        ? t("sim.lossAnalysis.slopeVerdict.exitSignalSecondary")
        : null;

  if (variant === "inline") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-1 py-0.5 ${slopeVerdictToneClasses(tone)}`}
        title={summaryLabel}
      >
        <SlopeVerdictPill
          verdict={ctx.stabilityVerdict}
          size="sm"
          showFlatWhenNone={alwaysShow}
          curveRisingHold={ctx.curveRisingHold}
          lang={it ? "it" : "en"}
        />
      </span>
    );
  }

  const exitActionable =
    canExecuteExit &&
    onExecuteExit &&
    (ctx.stabilityVerdict === "exit" || ctx.stabilityVerdict === "avoid");

  const pill = (
    <SlopeVerdictPill
      verdict={ctx.stabilityVerdict}
      size={variant === "hero" ? "md" : "sm"}
      showFlatWhenNone={alwaysShow}
      curveRisingHold={ctx.curveRisingHold}
      lang={it ? "it" : "en"}
    />
  );

  const pillNode = exitActionable ? (
    <span
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-full shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]/50"
      title={t("sim.lossAnalysis.exitSell.title")}
      onClick={onExecuteExit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExecuteExit();
        }
      }}
    >
      {pill}
    </span>
  ) : (
    pill
  );

  if (variant === "compact") {
    return (
      <div
        className={`rounded-md border text-left px-2 py-1 min-w-0 ${slopeVerdictBannerClasses(tone)}`}
      >
        <div className="flex items-start gap-1.5 min-w-0">
          <div className="min-w-0 flex-1 space-y-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wide opacity-85 leading-none">
              {t("sim.lossAnalysis.metric.slopeVerdict")}
            </span>
            <SlopeVerdictSummaryLine
              verdict={ctx.stabilityVerdict}
              text={summaryLabel}
              className="text-[11px] font-semibold leading-snug line-clamp-2"
              curveRisingHold={risingFlat}
            />
            {contextNote ? (
              <p className="text-[9px] text-ink-muted leading-snug mt-0.5">{contextNote}</p>
            ) : null}
          </div>
          {pillNode}
        </div>
      </div>
    );
  }

  const hero = variant === "hero";
  const pad = hero ? "px-4 py-3" : "px-3 py-2.5";
  const textSize = hero ? "text-sm" : "text-sm";

  return (
    <div
      className={`w-full rounded-lg border-2 text-left ${pad} ${slopeVerdictBannerClasses(tone, { hero })}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-85">
          {t("sim.lossAnalysis.metric.slopeVerdict")}
        </span>
        {pillNode}
      </div>
      <SlopeVerdictSummaryLine
        verdict={ctx.stabilityVerdict}
        text={summaryLabel}
        className={`${textSize} font-semibold leading-snug mt-1.5`}
        curveRisingHold={risingFlat}
      />
      {contextNote ? (
        <p className="text-[10px] text-ink-muted leading-snug mt-1">{contextNote}</p>
      ) : null}
    </div>
  );
}
