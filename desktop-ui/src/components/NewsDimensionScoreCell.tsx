/**
 * Compact Clin / Fin / Corp / Access chips for Catalyst + Top KPI tables.
 * EIS is per-event only — never shown as a ticker sum here.
 */
import type { NewsDimensionScores } from "../sheet/newsDimensionScores";
import { formatNewsDimScore } from "../sheet/newsDimensionScores";

const CHIP_MIN = 0.25;
const POS = "#34D399";
const NEG = "#F87185";
const NEU = "#F3F5FA";

function toneClass(n: number | null): string {
  if (n == null)
    return "border-white/35 bg-white/[0.06] text-[#F3F5FA]";
  if (n > 0.15)
    return "border-[#34D399]/80 bg-[#34D399]/20 text-[#6EE7B7]";
  if (n < -0.15)
    return "border-[#F87185]/80 bg-[#F87185]/20 text-[#FDA4AF]";
  return "border-white/30 bg-white/[0.06] text-[#F3F5FA]";
}

function scoreInk(n: number | null): string {
  if (n == null) return NEU;
  if (n > 0.15) return POS;
  if (n < -0.15) return NEG;
  return NEU;
}

function Chip({
  label,
  score,
  always,
}: {
  label: string;
  score: number | null;
  always?: boolean;
}) {
  if (!always && (score == null || Math.abs(score) < CHIP_MIN)) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-bold tabular-nums leading-none ${toneClass(score)}`}
    >
      <span className="font-semibold">{label}</span>
      <span style={{ color: scoreInk(score) }}>{formatNewsDimScore(score)}</span>
    </span>
  );
}

export function NewsDimensionScoreCell({
  scores,
  it,
}: {
  scores: NewsDimensionScores | null | undefined;
  it: boolean;
}) {
  if (!scores || scores.n <= 0) {
    return <span className="text-ink-muted">—</span>;
  }
  const hours = scores.lookbackHours ?? 36;
  const tip = [
    scores.tipTitle,
    scores.source === "deep_dive"
      ? it
        ? `Σ Clin / Fin / Acc ultime ${hours}h (Deep Dive) — EIS solo per evento`
        : `Σ Clin / Fin / Acc last ${hours}h (Deep Dive) — EIS per event only`
      : scores.source === "mixed"
        ? it
          ? `Σ ${hours}h Deep Dive + Daily News (riempie i buchi) — no Σ EIS`
          : `Σ ${hours}h Deep Dive + Daily News (fills gaps) — no EIS sum`
        : scores.n > 1
          ? it
            ? `Σ ${scores.n} articoli Daily News (ultime ${hours}h · Clin/Fin/Acc)`
            : `Σ ${scores.n} Daily News articles (last ${hours}h · Clin/Fin/Acc)`
          : it
            ? `Da Daily News (ultime ${hours}h · Clin/Fin/Acc)`
            : `From Daily News (last ${hours}h · Clin/Fin/Acc)`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className="inline-flex max-w-full min-w-0 flex-wrap items-center justify-center gap-0.5"
      title={tip}
    >
      <Chip label="Clin" score={scores.clinical} />
      <Chip label="Fin" score={scores.financial} />
      <Chip label={it ? "Soc" : "Corp"} score={scores.corporate} />
      <Chip label="Acc" score={scores.marketAccess} />
    </span>
  );
}
