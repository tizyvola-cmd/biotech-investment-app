import type { CdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { computeCdPatternPriorityIndex } from "../sheet/cdPatternPortfolioPriority";
import { useT } from "../shared/i18n";

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function radarPolygonPoints(values: number[], size: number): string {
  const n = values.length;
  if (n === 0) return "";
  const pad = 3;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - pad;
  return values
    .map((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = (clampPct(v) / 100) * maxR;
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    })
    .join(" ");
}

function CdPatternSketch({
  rec,
  size = 40,
}: {
  rec: CdPatternTickerRecommendation;
  size?: number;
}) {
  const targetPts = radarPolygonPoints(rec.radarTarget, size);
  const currentPts = radarPolygonPoints(rec.radarCurrent, size);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden
    >
      <polygon
        points={targetPts}
        fill="none"
        stroke="rgb(var(--sn-long-text))"
        strokeWidth="1"
        strokeDasharray="2 2"
        opacity={0.45}
      />
      <polygon
        points={currentPts}
        fill="rgb(var(--chart-model))"
        fillOpacity={0.22}
        stroke="rgb(var(--chart-model))"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CdPatternSummaryCell({
  rec,
  inPortfolio = false,
}: {
  rec: CdPatternTickerRecommendation | null;
  inPortfolio?: boolean;
}) {
  const t = useT();
  if (!rec) return <span className="text-ink-muted">—</span>;
  const ppi = computeCdPatternPriorityIndex({ rec, inPortfolio });
  return (
    <div
      className="flex flex-col items-center justify-center gap-0.5 mx-auto w-[52px]"
      title={`${t("decisionLab.pattern.colPriorityTip")} · ${rec.matchPct}% match`}
    >
      <CdPatternSketch rec={rec} />
      <span className="text-[9px] font-bold tabular-nums leading-none text-ink">
        PPI {ppi}
      </span>
    </div>
  );
}
