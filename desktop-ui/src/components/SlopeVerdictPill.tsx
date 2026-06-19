import {
  flatSlopeVerdictSummary,
  risingFlatSlopeVerdictSummary,
  verdictLabel,
  verdictTone,
  type StabilityVerdict,
} from "../sheet/slopeStability";

export function slopeVerdictIcon(verdict: StabilityVerdict): string {
  switch (verdict) {
    case "entry":
      return "↑ ENTRY";
    case "persistent":
      return "→ HOLD";
    case "exit":
      return "↩ EXIT";
    case "avoid":
      return "✕ AVOID";
    case "watch":
      return "⏸ WATCH";
    default:
      return "";
  }
}

/** Giallo / rosso / verde fissi — non ereditano --warn del tema violet (rosa). */
export function slopeVerdictToneClasses(tone: ReturnType<typeof verdictTone>): string {
  switch (tone) {
    case "positive":
      return "bg-emerald-100 text-emerald-800 border-emerald-400/70";
    case "negative":
      return "bg-red-100 text-red-700 border-red-400/75";
    case "warn":
      return "bg-amber-100 text-amber-800 border-amber-400/75";
    default:
      return "bg-slate-100 text-slate-600 border-slate-300/70";
  }
}

/** Banner Slope Verdict — sfondo sfumato verde / giallo / rosso. */
export function slopeVerdictBannerClasses(
  tone: ReturnType<typeof verdictTone>,
  opts?: { hero?: boolean },
): string {
  const hero = opts?.hero ? " sn-slope-verdict-banner--hero" : "";
  switch (tone) {
    case "positive":
      return `sn-slope-verdict-banner sn-slope-verdict-banner--positive${hero}`;
    case "negative":
      return `sn-slope-verdict-banner sn-slope-verdict-banner--negative${hero}`;
    case "warn":
      return `sn-slope-verdict-banner sn-slope-verdict-banner--warn${hero}`;
    default:
      return `sn-slope-verdict-banner sn-slope-verdict-banner--neutral${hero}`;
  }
}

/** Pill compatto per verdetto pendenza (entry/exit/…). */
export function SlopeVerdictPill({
  verdict,
  size = "sm",
  showLabel = false,
  showFlatWhenNone = false,
  curveRisingHold = false,
  lang = "en",
}: {
  verdict: StabilityVerdict;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  /** Mostra pill FLAT/RISE quando il verdetto formale è none (pendenza sotto soglia rumore). */
  showFlatWhenNone?: boolean;
  /** Curva ↑ verso target — mostra RISE verde invece di FLAT grigio. */
  curveRisingHold?: boolean;
  lang?: "it" | "en";
}) {
  if (verdict === "none") {
    if (!showFlatWhenNone) return null;
    const sizeCls =
      size === "lg"
        ? "px-3 py-1.5 text-xs"
        : size === "md"
          ? "px-2.5 py-1 text-[11px]"
          : "px-2 py-0.5 text-[10px]";
    if (curveRisingHold) {
      return (
        <span
          className={`inline-flex items-center rounded-full border font-bold tracking-wide ${sizeCls} ${slopeVerdictToneClasses("positive")}`}
          title={risingFlatSlopeVerdictSummary(lang)}
        >
          ↑ RISE
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center rounded-full border font-bold tracking-wide ${sizeCls} ${slopeVerdictToneClasses("neutral")}`}
        title={flatSlopeVerdictSummary(lang)}
      >
        ○ FLAT
      </span>
    );
  }
  const tone = verdictTone(verdict);
  const sizeCls =
    size === "lg"
      ? "px-3 py-1.5 text-xs"
      : size === "md"
        ? "px-2.5 py-1 text-[11px]"
        : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-bold tracking-wide ${sizeCls} ${slopeVerdictToneClasses(tone)}`}
      title={verdictLabel(verdict)}
    >
      {slopeVerdictIcon(verdict)}
      {showLabel ? (
        <span className="ml-1.5 font-semibold normal-case tracking-normal opacity-90">
          {verdictLabel(verdict)}
        </span>
      ) : null}
    </span>
  );
}
