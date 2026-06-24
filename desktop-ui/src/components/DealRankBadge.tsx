import { getLang } from "../shared/i18n";
import {
  dealRankLabel,
  dealRankLabelPnl,
  dealRankLabelPnlList,
  dealRankLabelWorstFirst,
  dealRankTitlePnl,
  dealRankTitlePnlList,
  dealRankVisual,
  dealRankVisualFromGainPct,
  dealRankVisualPnlList,
  dealRankVisualWorstFirst,
  type DealRankIconKind,
  type DealRankVisual,
} from "../sheet/dealRankIcon";

export type DealRankOrder = "best_first" | "worst_first";

function resolveVisual(
  rankIndex: number,
  total: number,
  order: DealRankOrder,
): DealRankVisual {
  return order === "worst_first"
    ? dealRankVisualWorstFirst(rankIndex, total)
    : dealRankVisual(rankIndex, total);
}

function resolveLabel(
  lang: "it" | "en",
  rankIndex: number,
  total: number,
  order: DealRankOrder,
  labelMode: "deal" | "pnl",
): string {
  if (labelMode === "pnl") {
    return dealRankLabelPnl(lang, rankIndex, total);
  }
  return order === "worst_first"
    ? dealRankLabelWorstFirst(lang, rankIndex, total)
    : dealRankLabel(lang, rankIndex, total);
}

/** Pig / worst-tier animal with optional crown centered on the head. */
export function RankAnimalIcon({
  visual,
  basePx = 18,
}: {
  visual: Pick<DealRankVisual, "kind" | "emoji" | "crown" | "scale">;
  basePx?: number;
}) {
  const pigPx = Math.round(basePx * visual.scale);
  const crownPx = Math.round(pigPx * 0.52);
  const filter =
    visual.kind === "crown_pig"
      ? "saturate(1.15) drop-shadow(0 0 3px rgba(255,200,80,0.55))"
      : visual.kind === "worst"
        ? "saturate(0.9) brightness(0.92)"
        : undefined;

  return (
    <span
      className="relative inline-flex items-end justify-center shrink-0 leading-none"
      style={{ width: pigPx, height: pigPx, marginTop: visual.crown ? Math.round(crownPx * 0.35) : 0 }}
      aria-hidden
    >
      {visual.crown && (
        <span
          className="absolute left-1/2 -translate-x-1/2 leading-none pointer-events-none z-[1]"
          style={{
            fontSize: crownPx,
            top: `-${Math.round(crownPx * 0.62)}px`,
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.2))",
          }}
        >
          👑
        </span>
      )}
      <span className="leading-none" style={{ fontSize: pigPx, filter }}>
        {visual.emoji}
      </span>
    </span>
  );
}

/** Tab / compact: crowned pig for P&L view branding. */
export function PnlCardRankBadge({
  rankIndex,
  total,
  lang = getLang(),
  scope = "total",
}: {
  rankIndex: number;
  total: number;
  lang?: "it" | "en";
  scope?: "today" | "total";
}) {
  if (total <= 1 || rankIndex < 0) return null;
  const v = dealRankVisualPnlList(rankIndex, total);
  const title = dealRankTitlePnlList(lang, rankIndex, total, scope);
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 leading-none"
      title={title}
      aria-label={title}
    >
      <RankAnimalIcon visual={v} basePx={rankIndex === 0 || rankIndex === total - 1 ? 20 : 17} />
      <span className="text-[9px] font-semibold text-ink-muted self-center">
        {dealRankLabelPnlList(lang, rankIndex, total)}
      </span>
    </span>
  );
}

export function PnlTabRankIcon({ active }: { active?: boolean }) {
  const visual: DealRankVisual = {
    kind: "crown_pig",
    emoji: "🐷",
    crown: true,
    scale: active ? 1.05 : 0.92,
    titleIt: "P&L per ticker — ranking maiale",
    titleEn: "P&L per ticker — pig ranking",
  };
  return (
    <RankAnimalIcon
      visual={visual}
      basePx={active ? 16 : 14}
    />
  );
}

export function DealRankBadge({
  rankIndex,
  total,
  lang = getLang(),
  rankOrder = "worst_first",
  showLabel = true,
  labelMode = "deal",
  titleOverride,
}: {
  rankIndex: number;
  total: number;
  lang?: "it" | "en";
  /** best_first: #1 = crown (Top BUY/SELL). worst_first: last = crown (P&L list). */
  rankOrder?: DealRankOrder;
  showLabel?: boolean;
  /** deal = gain atteso Top Opps; pnl = ranking P&L portfolio */
  labelMode?: "deal" | "pnl";
  titleOverride?: string;
}) {
  const v = resolveVisual(rankIndex, total, rankOrder);
  const title = titleOverride ?? (lang === "it" ? v.titleIt : v.titleEn);
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 leading-none"
      title={title}
      aria-label={title}
    >
      <RankAnimalIcon visual={v} />
      {showLabel && (
        <span className="text-[9px] font-semibold text-ink-muted self-center">
          {resolveLabel(lang, rankIndex, total, rankOrder, labelMode)}
        </span>
      )}
    </span>
  );
}

export function dealRankIconKindForIndex(
  rankIndex: number,
  total: number,
  order: DealRankOrder,
): DealRankIconKind {
  return resolveVisual(rankIndex, total, order).kind;
}

/** Simulation «Growth» column — rank among open positions (same tiers as P&L). */
export function PnlRankGrowthIcon({
  rankIndex,
  total,
  hasPosition,
  lang = getLang(),
  basePx = 18,
}: {
  rankIndex: number | null;
  total: number;
  hasPosition: boolean;
  lang?: "it" | "en";
  basePx?: number;
}) {
  if (!hasPosition || total <= 0 || rankIndex == null || rankIndex < 0) {
    return (
      <span className="text-ink-muted/35 text-sm leading-none" title="—">
        ·
      </span>
    );
  }
  const v = dealRankVisual(rankIndex, total);
  const title = lang === "it" ? v.titleIt : v.titleEn;
  return (
    <span title={title} aria-label={title} className="inline-flex justify-center">
      <RankAnimalIcon visual={v} basePx={basePx} />
    </span>
  );
}

/** Piggy bank hero / aggregate % — crowned pig when portfolio gains are strong. */
export function PortfolioHeroRankIcon({
  gainPct,
  noData,
  basePx = 40,
}: {
  gainPct: number;
  noData: boolean;
  basePx?: number;
}) {
  const v = noData ? dealRankVisual(0, 1) : dealRankVisualFromGainPct(gainPct);
  return <RankAnimalIcon visual={v} basePx={basePx} />;
}

export { dealRankTitlePnl };
