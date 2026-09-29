import { WindIcon } from "./WindIcon";
import type { MobileDashWindRow } from "../mobileDashWindTable";

/** P(cont) → wind tint: azure (low) · yellow (mid) · green (strong ≥50%). */
export function pContWindTone(
  pCont: number | null | undefined,
): "green" | "yellow" | "azure" | "muted" {
  if (pCont == null || !Number.isFinite(pCont)) return "muted";
  if (pCont >= 50) return "green";
  if (pCont >= 35) return "yellow";
  return "azure";
}

type Props = {
  windKind: MobileDashWindRow["windKind"];
  pCont: number | null;
  it?: boolean;
};

/**
 * Compact P(cont) cell: colored wind by continuation probability.
 * Early-run / not-yet-run → smaller muted wind only (no EARLY RUN text).
 */
export function PContWindCell({ windKind, pCont, it = false }: Props) {
  if (windKind === "declining") {
    const title = it ? "In calo (vento contrario)" : "Declining (headwind)";
    return (
      <span className="dash-pcont-wind dash-pcont-wind--down" title={title}>
        <WindIcon className="dash-wind-svg dash-wind-svg--sm" />
      </span>
    );
  }

  if (windKind === "early_run") {
    const title = it ? "Corsa nascente — vento debole" : "Early run — light wind";
    return (
      <span className="dash-pcont-wind dash-pcont-wind--early" title={title}>
        <WindIcon className="dash-wind-svg dash-wind-svg--sm" />
      </span>
    );
  }

  if (windKind === "pct" && pCont != null && Number.isFinite(pCont)) {
    const tone = pContWindTone(pCont);
    const pct = Math.round(pCont);
    const title = it
      ? `P(continuazione) ${pct}% — probabilità che salga ancora`
      : `P(continuation) ${pct}% — chance it keeps rising`;
    return (
      <span
        className={`dash-pcont-wind dash-pcont-wind--${tone}`}
        title={title}
        aria-label={title}
      >
        <WindIcon className="dash-wind-svg" />
        <span className="dash-pcont-wind-pct tabular-nums">{pct}%</span>
      </span>
    );
  }

  return <span className="dash-pcont-wind dash-pcont-wind--muted">—</span>;
}
