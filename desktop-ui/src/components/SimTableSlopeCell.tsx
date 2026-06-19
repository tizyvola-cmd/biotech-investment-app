import { useT } from "../shared/i18n";
import { todayModelRealTone } from "../sheet/priceVariationHorizons";
import type { SimRowSlopeDisplay } from "../sheet/simTableSlopeDisplay";
function slopeColWidths(compact: boolean) {
  if (compact) {
    return {
      gap: "min-w-0 flex-1 basis-0",
      delta: "min-w-0 flex-1 basis-0",
      gapText: "text-[10px]",
      deltaText: "text-[10px]",
      headerGap: "text-[8px]",
      headerDelta: "text-[10px]",
      rowGap: "gap-1",
    };
  }
  return {
    gap: "min-w-[4.25rem] w-[4.25rem] shrink-0",
    delta: "min-w-[5.25rem] w-[5.25rem] shrink-0",
    gapText: "text-xs",
    deltaText: "text-xs",
    headerGap: "text-[9px]",
    headerDelta: "text-xs",
    rowGap: "gap-3",
  };
}

function CurveGapInline({
  gapPct,
  gapUsd,
}: {
  gapPct: number | null | undefined;
  gapUsd: number | null | undefined;
}) {
  const t = useT();
  if (gapPct == null) {
    return <span className="text-xs text-ink-muted">—</span>;
  }
  const toneCls = todayModelRealTone(gapPct);
  const tip =
    gapUsd != null
      ? t("sim.workspace.table.gapVsCurveTipDetail", {
          pct: `${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(2)}`,
          usd:
            gapUsd >= 0
              ? `+$${Math.abs(gapUsd).toFixed(2)}`
              : `−$${Math.abs(gapUsd).toFixed(2)}`,
        })
      : t("sim.workspace.table.gapVsCurveTip");

  return (
    <div className="text-right leading-snug tabular-nums" title={tip}>
      <div className={`text-xs font-semibold ${toneCls}`}>
        {gapPct >= 0 ? "+" : ""}
        {gapPct.toFixed(2)}%
      </div>
    </div>
  );
}

export function SimTableSlopeColumnHeader({
  lang: _lang,
  compact = false,
  showGap = true,
}: {
  lang: "it" | "en";
  compact?: boolean;
  /** When Δ vs curve has its own column, header shows slope only. */
  showGap?: boolean;
}) {
  const t = useT();
  const w = slopeColWidths(compact);
  if (!showGap) {
    return (
      <span className="block text-center font-medium leading-tight truncate">
        {t("signals.slope.col.slopeDelta.label")}
      </span>
    );
  }
  return (
    <div className={`inline-flex items-end justify-end ${w.rowGap} w-full max-w-full`}>
      <span
        className={`${w.gap} text-right ${w.headerGap} font-semibold uppercase tracking-wide text-ink-muted/75 pb-0.5 truncate`}
        title={t("sim.workspace.table.gapVsCurveTip")}
      >
        {t("sim.workspace.table.gapVsCurve")}
      </span>
      <span className={`${w.delta} text-right ${w.headerDelta} font-medium leading-tight truncate`}>
        {t("signals.slope.col.slopeDelta.label")}
      </span>
    </div>
  );
}

export function SimTableSlopeCell({
  display,
  curveGapPct,
  curveGapUsd,
  compact = false,
  showGap = true,
}: {
  display: SimRowSlopeDisplay | null;
  curveGapPct?: number | null;
  curveGapUsd?: number | null;
  compact?: boolean;
  showGap?: boolean;
}) {
  const w = slopeColWidths(compact);
  const hasSlope =
    display != null &&
    (display.slope5d != null || display.slope20d != null);

  if (!showGap) {
    if (!hasSlope || !display) {
      return <span className="text-center text-xs text-ink-muted">—</span>;
    }
    const tip = [display.shiftLine, display.subLine].filter(Boolean).join(" · ");
    return (
      <div
        className={`${w.deltaText} leading-snug tabular-nums text-center overflow-hidden`}
        title={tip || undefined}
      >
        <div className={`font-semibold truncate ${display.toneCls}`}>{display.shiftLine}</div>
        {display.subLine ? (
          <div className="text-[8px] text-ink-muted/85 mt-0.5 truncate">{display.subLine}</div>
        ) : null}
      </div>
    );
  }

  if (!hasSlope && curveGapPct == null) {
    return (
      <div className={`flex items-center justify-end ${w.rowGap} w-full max-w-full`}>
        <span className={`${w.gap} text-right ${w.gapText} text-ink-muted`}>—</span>
        <span className={`${w.delta} text-right ${w.deltaText} text-ink-muted`}>—</span>
      </div>
    );
  }

  const tip = display
    ? [display.shiftLine, display.subLine].filter(Boolean).join(" · ")
    : "";

  return (
    <div
      className={`flex items-center justify-end ${w.rowGap} w-full max-w-full overflow-hidden`}
      title={tip || undefined}
    >
      <div className={`${w.gap} overflow-hidden`}>
        <CurveGapInline gapPct={curveGapPct} gapUsd={curveGapUsd} />
      </div>
      {hasSlope && display ? (
        <div className={`${w.delta} ${w.deltaText} leading-snug tabular-nums text-right overflow-hidden`}>
          <div className={`font-semibold truncate ${display.toneCls}`}>{display.shiftLine}</div>
          {display.subLine ? (
            <div className="text-[8px] text-ink-muted/85 mt-0.5 truncate">{display.subLine}</div>
          ) : null}
        </div>
      ) : (
        <span className={`${w.delta} text-right ${w.deltaText} text-ink-muted`}>—</span>
      )}
    </div>
  );
}
