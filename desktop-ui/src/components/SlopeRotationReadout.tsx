import { computeSlopeRotationFlag } from "../sheet/slopeStability";
import { fmtSlopePp } from "../sheet/slopeEventSummary";
import { useT } from "../shared/i18n";
import { SlopeTrendDiagram } from "./SlopeTrendDiagram";

export function SlopeRotationReadout({
  slope5d,
  slope20d,
}: {
  slope5d: number | null;
  slope20d: number | null;
}) {
  const t = useT();
  const rotation = computeSlopeRotationFlag(slope5d, slope20d) === 1;
  const decel =
    !rotation &&
    slope5d != null &&
    slope20d != null &&
    slope5d * slope20d > 0 &&
    Math.abs(slope5d) < Math.abs(slope20d);
  const liveDelta =
    slope5d != null && slope20d != null
      ? Math.round((slope5d - slope20d) * 100) / 100
      : 0;

  if (!rotation && !decel) return null;

  const toneCls = rotation
    ? "border-[rgb(var(--signal-down))]/45 bg-[rgb(var(--signal-down))]/[0.08]"
    : "border-[rgb(var(--warn))]/45 bg-[rgb(var(--warn))]/[0.08]";
  const titleCls = rotation ? "text-[rgb(var(--signal-down))]" : "text-[rgb(var(--warn))]";

  return (
    <div className={`rounded-lg border px-3 py-2 flex flex-wrap items-center gap-3 ${toneCls}`}>
      <SlopeTrendDiagram
        slope5d={slope5d}
        slope20d={slope20d}
        errorKind={rotation ? "slope_rev" : "slope_dec"}
      />
      <div className="flex-1 min-w-[10rem] space-y-0.5">
        <p className={`text-[11px] font-bold ${titleCls}`}>
          {rotation
            ? t("signals.slopeCharts.readout.reversal.title")
            : t("signals.slopeCharts.readout.deceleration.title")}
        </p>
        <p className="text-[10px] text-ink-muted leading-snug">
          {rotation
            ? t("signals.slopeCharts.readout.reversal.body", {
                s5: fmtSlopePp(slope5d),
                s20: fmtSlopePp(slope20d),
              })
            : t("signals.slopeCharts.readout.deceleration.body", {
                delta: fmtSlopePp(liveDelta),
              })}
        </p>
      </div>
    </div>
  );
}
