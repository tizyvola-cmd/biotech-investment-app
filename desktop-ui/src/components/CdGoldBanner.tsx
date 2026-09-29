import { CD_GOLD, CD_GOLD_INK } from "../sheet/priceVariationSeries";

/** Vertical gold band + “CD” pill on price / volume charts. */
export function CdGoldBanner({
  viewBox,
}: {
  viewBox?: { x?: number; y?: number; height?: number };
}) {
  const x = Number(viewBox?.x ?? 0);
  const y = Number(viewBox?.y ?? 0);
  const h = Number(viewBox?.height ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(h) || h <= 0) return null;
  return (
    <g pointerEvents="none">
      <rect x={x - 5} y={y} width={10} height={h} fill={CD_GOLD} fillOpacity={0.22} />
      <rect x={x - 14} y={y} width={28} height={13} rx={3} fill={CD_GOLD} />
      <text
        x={x}
        y={y + 10}
        textAnchor="middle"
        fill={CD_GOLD_INK}
        fontSize={8}
        fontWeight={800}
        letterSpacing={0.4}
      >
        CD
      </text>
    </g>
  );
}
