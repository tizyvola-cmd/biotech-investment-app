import { useState } from "react";
import { useLang, useT } from "../shared/i18n";
import type { MIGResult } from "../sheet/marketInterestGate";
import { AppModal, AppModalCloseButton } from "./AppModal";

/**
 * Detail modal opened by clicking an MII cell in the Top KPI table.
 *
 * Reader-first: the top of the modal answers "what does this number mean?"
 * in plain language; the raw math (arctan / ln / √) lives in a collapsible
 * "technical breakdown" section for people who want to audit the number.
 */
export function MiiDetailModal({
  open,
  onClose,
  ticker,
  row,
}: {
  open: boolean;
  onClose: () => void;
  ticker: string;
  row: MIGResult | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  if (!open) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      align="center"
      aria-label={t("sim.mii.detail.title")}
      panelClassName="w-full max-w-md rounded-2xl border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl overflow-hidden"
    >
      <div className="flex items-start gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--accent))]/8 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {t("sim.mii.detail.title")} · {ticker.toUpperCase()}
          </p>
          <p className="text-[11px] text-ink-muted leading-snug">
            {t("sim.mii.detail.subtitle")}
          </p>
        </div>
        <AppModalCloseButton onClose={onClose} className="flex h-7 w-7 items-center justify-center" />
      </div>

      <div className="max-h-[75vh] overflow-y-auto px-4 py-3">
        {row ? (
          <MiiDetailBody row={row} it={it} />
        ) : (
          <p className="text-[12px] text-ink-muted py-6 text-center">
            {t("sim.mii.detail.missing")}
          </p>
        )}
      </div>
    </AppModal>
  );
}

function MiiDetailBody({ row, it }: { row: MIGResult; it: boolean }) {
  const NORMALIZATION = 15;
  const LOW_VOL_THRESHOLD = 0.8;
  const PASS_MIN_DEG = 20;
  const WATCH_MIN_DEG = 12;

  const dp = row.deltaPricePct;
  const vr = Math.max(0, row.volRatio);
  const lnPart = Math.log(vr + 1);
  const sqrtPart = Math.sqrt(vr);
  const rawBefore = dp * lnPart * sqrtPart;
  const rawFinal = row.miiRaw;
  const penaltyApplied = row.lowVolumePenalty;
  const angle = row.slopeAngleDeg;
  const absAngle = Math.abs(angle);

  const sourceKind = classifyDeltaSource(row.deltaSource ?? "");
  const angleColor =
    angle > 0 ? "text-[rgb(var(--signal-up))]" : angle < 0 ? "text-[rgb(var(--signal-down))]" : "text-ink";

  const strengthLabel = strengthLabelFor(absAngle, it);
  const directionLabel = angle > 0
    ? it ? "interesse in salita" : "rising interest"
    : angle < 0
    ? it ? "interesse in discesa" : "falling interest"
    : it ? "neutro" : "neutral";

  const volLabel = volumeLabelFor(vr, LOW_VOL_THRESHOLD, it);
  const priceMoveLabel = it
    ? `${dp >= 0 ? "salito" : "sceso"} del ${Math.abs(dp).toFixed(1)}%`
    : `moved ${dp >= 0 ? "up" : "down"} ${Math.abs(dp).toFixed(1)}%`;

  const bottomLine = it
    ? `Negli ultimi ~5 giorni il prezzo è ${priceMoveLabel}, ${volLabel.textIt}. Combinando movimento e volume, l'interesse di mercato risulta ${strengthLabel.toLowerCase()} — ${directionLabel}.`
    : `Over the last ~5 days the price ${priceMoveLabel}, ${volLabel.textEn}. Combining move and volume, market interest comes out ${strengthLabel.toLowerCase()} — ${directionLabel}.`;

  const [showMath, setShowMath] = useState(false);

  return (
    <div className="space-y-3 text-[12px]">
      {/* Hero: the number + one-line meaning */}
      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-2))]/40 px-3 py-3 text-center">
        <p className={`text-[26px] font-bold tabular-nums leading-none ${angleColor}`}>
          {angle >= 0 ? "+" : ""}
          {angle.toFixed(1)}°
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          {it ? "Angolo di interesse mercato" : "Market interest angle"}
        </p>
        <VerdictBadge verdict={row.verdict} absAngle={absAngle} passMin={PASS_MIN_DEG} watchMin={WATCH_MIN_DEG} it={it} />
      </div>

      {/* Plain-english summary */}
      <p className="rounded-md border border-[rgb(var(--border))]/40 bg-white/60 dark:bg-black/20 px-3 py-2 leading-relaxed text-ink">
        {bottomLine}
      </p>

      {/* Two visual "chips" for price move + volume */}
      <div className="grid grid-cols-2 gap-2">
        <Chip
          label={it ? "Prezzo (5g)" : "Price (5d)"}
          value={`${dp >= 0 ? "+" : ""}${dp.toFixed(1)}%`}
          note={describeSource(sourceKind, it)}
          tone={dp >= 0 ? "up" : "down"}
        />
        <Chip
          label={it ? "Volume vs media" : "Volume vs avg"}
          value={`${vr.toFixed(2)}×`}
          note={volLabel.chipHint}
          tone={vr >= LOW_VOL_THRESHOLD ? "up" : "warn"}
        />
      </div>

      {/* Low-vol penalty callout (only when it fired) */}
      {penaltyApplied ? (
        <div className="rounded-md border border-amber-400/50 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-900/25 px-3 py-2 leading-snug">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            {it ? "⚠ Penalty low-volume attiva" : "⚠ Low-volume penalty active"}
          </p>
          <p className="text-[11px] text-amber-800/90 dark:text-amber-100/90">
            {it
              ? `Il volume è sotto ${LOW_VOL_THRESHOLD}× la media a 20 giorni. Il rialzo del prezzo viene ridotto di 45% per evitare falsi segnali (rally leggeri su bassa partecipazione).`
              : `Volume is below ${LOW_VOL_THRESHOLD}× the 20-day average. The upside is dampened by 45% to avoid false signals from thin-volume rallies.`}
          </p>
        </div>
      ) : null}

      {/* Verdict scale */}
      <div className="rounded-md border border-[rgb(var(--border))]/40 bg-white/60 dark:bg-black/20 px-3 py-2 space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {it ? "Scala del verdetto" : "Verdict scale"}
        </p>
        <VerdictScale angle={angle} passMin={PASS_MIN_DEG} watchMin={WATCH_MIN_DEG} it={it} />
      </div>

      {/* Collapsible: raw math for auditors */}
      <div className="rounded-md border border-[rgb(var(--border))]/40 bg-white/60 dark:bg-black/20">
        <button
          type="button"
          onClick={() => setShowMath((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-ink-muted hover:text-ink"
        >
          <span>
            {it ? "🔬 Formula tecnica" : "🔬 Technical formula"}
          </span>
          <span className="text-[9px]">{showMath ? "▲" : "▼"}</span>
        </button>
        {showMath ? (
          <div className="px-3 pb-3 space-y-2 border-t border-[rgb(var(--border))]/40">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
                {it ? "1. Sorgente ΔP" : "1. ΔP source"}
              </p>
              <p className="font-mono text-[11px]">
                {describeSourceFormula(sourceKind, it)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
                {it ? "2. MII raw" : "2. Raw MII"}
              </p>
              <div className="font-mono text-[11px] leading-relaxed">
                <p>raw = ΔP × ln(vol + 1) × √vol</p>
                <p className="text-ink-muted pl-4">
                  = {fmt(dp, 2)} × {fmt(lnPart, 3)} × {fmt(sqrtPart, 3)} = {fmt(rawBefore, 3)}
                </p>
                {penaltyApplied ? (
                  <p className="text-amber-700 dark:text-amber-300 pl-4">
                    × 0.55 (low-vol penalty) → {fmt(rawFinal, 3)}
                  </p>
                ) : null}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
                {it ? "3. Angolo" : "3. Angle"}
              </p>
              <p className="font-mono text-[11px]">
                arctan({fmt(rawFinal, 3)} / {NORMALIZATION}) × 180/π ={" "}
                <span className={`font-bold ${angleColor}`}>
                  {angle >= 0 ? "+" : ""}
                  {angle.toFixed(2)}°
                </span>
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VerdictBadge({
  verdict,
  absAngle,
  passMin,
  watchMin,
  it,
}: {
  verdict: string;
  absAngle: number;
  passMin: number;
  watchMin: number;
  it: boolean;
}) {
  const meaning =
    verdict === "PASS"
      ? it
        ? `interesse forte (|angolo| ≥ ${passMin}°)`
        : `strong interest (|angle| ≥ ${passMin}°)`
      : verdict === "WATCH"
      ? it
        ? `interesse intermedio (${watchMin}°–${passMin}°) — osservare`
        : `intermediate interest (${watchMin}°–${passMin}°) — watch`
      : it
      ? `movimento debole (|angolo| < ${watchMin}°) — non un segnale`
      : `weak move (|angle| < ${watchMin}°) — not a signal`;
  const cls =
    verdict === "PASS"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
      : verdict === "WATCH"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
      : "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200";
  void absAngle;
  return (
    <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-0.5 text-[11px] font-semibold ${cls}`}>
      <span>{verdict}</span>
      <span className="font-normal opacity-80">· {meaning}</span>
    </div>
  );
}

function VerdictScale({
  angle,
  passMin,
  watchMin,
  it,
}: {
  angle: number;
  passMin: number;
  watchMin: number;
  it: boolean;
}) {
  // Visual scale: BLOCK region (slate), WATCH region (amber), PASS region (emerald)
  // Same on both sides of 0° since we look at the absolute angle.
  return (
    <div className="space-y-1">
      <div className="flex text-[9px] font-mono text-ink-muted justify-between px-0.5">
        <span>−90°</span>
        <span>−{passMin}°</span>
        <span>−{watchMin}°</span>
        <span>0°</span>
        <span>+{watchMin}°</span>
        <span>+{passMin}°</span>
        <span>+90°</span>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700/40">
        {/* WATCH bands */}
        <div className="absolute inset-y-0 bg-amber-300/70 dark:bg-amber-500/50" style={{ left: `${pctForAngle(-passMin)}%`, width: `${pctForAngle(-watchMin) - pctForAngle(-passMin)}%` }} />
        <div className="absolute inset-y-0 bg-amber-300/70 dark:bg-amber-500/50" style={{ left: `${pctForAngle(watchMin)}%`, width: `${pctForAngle(passMin) - pctForAngle(watchMin)}%` }} />
        {/* PASS bands */}
        <div className="absolute inset-y-0 bg-emerald-400/70 dark:bg-emerald-500/50" style={{ left: `0%`, width: `${pctForAngle(-passMin)}%` }} />
        <div className="absolute inset-y-0 bg-emerald-400/70 dark:bg-emerald-500/50" style={{ left: `${pctForAngle(passMin)}%`, width: `${100 - pctForAngle(passMin)}%` }} />
        {/* Pointer */}
        <div
          className="absolute -top-0.5 -bottom-0.5 w-[3px] bg-ink shadow"
          style={{ left: `calc(${pctForAngle(angle)}% - 1.5px)` }}
          aria-label={`current ${angle.toFixed(1)}°`}
        />
      </div>
      <p className="text-[10px] text-ink-muted leading-snug">
        {it
          ? `Verde = PASS (segnale forte). Ambra = WATCH (osservare). Grigio = BLOCK (movimento troppo debole per essere significativo). Il pallino nero segna la posizione corrente.`
          : `Green = PASS (strong signal). Amber = WATCH (watch). Grey = BLOCK (move too weak to be significant). The black tick marks the current position.`}
      </p>
    </div>
  );
}

/** Map an angle in [−90°, +90°] to a linear percentage 0–100. */
function pctForAngle(angleDeg: number): number {
  const clamped = Math.max(-90, Math.min(90, angleDeg));
  return ((clamped + 90) / 180) * 100;
}

function Chip({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "up" | "down" | "warn" | "neutral";
}) {
  const valueCls =
    tone === "up"
      ? "text-[rgb(var(--signal-up))]"
      : tone === "down"
      ? "text-[rgb(var(--signal-down))]"
      : tone === "warn"
      ? "text-amber-600 dark:text-amber-300"
      : "text-ink";
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/40 bg-white/70 dark:bg-black/20 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-[15px] font-bold tabular-nums ${valueCls}`}>{value}</p>
      <p className="text-[10px] text-ink-muted leading-snug">{note}</p>
    </div>
  );
}

function fmt(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

type DeltaSourceKind = "blend" | "monthly" | "weekly" | "daily" | "unknown";

function classifyDeltaSource(source: string): DeltaSourceKind {
  const s = source.toLowerCase();
  if (s.includes("slope5d") && s.includes("var.1m")) return "blend";
  if (s.includes("var.1m")) return "monthly";
  if (s.includes("slope5d")) return "weekly";
  if (s.includes("var.giorn") || s.includes("×5") || s.includes("fallback")) return "daily";
  return "unknown";
}

function describeSource(kind: DeltaSourceKind, it: boolean): string {
  switch (kind) {
    case "blend":
      return it
        ? "media settimana + mese"
        : "weekly + monthly blend";
    case "monthly":
      return it ? "dalla variazione mensile" : "from monthly change";
    case "weekly":
      return it ? "dalla slope a 5 giorni" : "from 5-day slope";
    case "daily":
      return it ? "fallback: var. giornaliera × 5" : "fallback: daily × 5";
    default:
      return it ? "sorgente sconosciuta" : "unknown source";
  }
}

function describeSourceFormula(kind: DeltaSourceKind, it: boolean): string {
  switch (kind) {
    case "blend":
      return "(slope5d × 5 + Var.1M × 5/22) / 2";
    case "monthly":
      return "Var.1M × 5/22";
    case "weekly":
      return "slope5d × 5";
    case "daily":
      return "Var.giorn × 5";
    default:
      return it ? "n/a" : "n/a";
  }
}

/** Human-readable strength label from absolute angle. */
function strengthLabelFor(absAngle: number, it: boolean): string {
  if (absAngle >= 30) return it ? "molto forte" : "very strong";
  if (absAngle >= 20) return it ? "forte" : "strong";
  if (absAngle >= 12) return it ? "moderato" : "moderate";
  if (absAngle >= 5) return it ? "debole" : "weak";
  return it ? "praticamente piatto" : "essentially flat";
}

/** Human-readable volume-ratio description. */
function volumeLabelFor(vr: number, threshold: number, it: boolean): {
  textIt: string;
  textEn: string;
  chipHint: string;
} {
  if (vr >= 1.5) {
    return {
      textIt: `con volume caldo (${vr.toFixed(2)}× la media)`,
      textEn: `with hot volume (${vr.toFixed(2)}× average)`,
      chipHint: it ? "sopra media → segnale confermato" : "above average → signal confirmed",
    };
  }
  if (vr >= threshold) {
    return {
      textIt: `con volume in linea (${vr.toFixed(2)}× la media)`,
      textEn: `with volume in line (${vr.toFixed(2)}× average)`,
      chipHint: it ? "in linea con la media" : "in line with average",
    };
  }
  if (vr >= 0.5) {
    return {
      textIt: `su volume tiepido (${vr.toFixed(2)}× la media)`,
      textEn: `on tepid volume (${vr.toFixed(2)}× average)`,
      chipHint: it
        ? `sotto ${threshold}× → il rialzo pesa meno`
        : `below ${threshold}× → upside dampened`,
    };
  }
  return {
    textIt: `su volume basso (${vr.toFixed(2)}× la media)`,
    textEn: `on thin volume (${vr.toFixed(2)}× average)`,
    chipHint: it ? "volume anemico" : "anaemic volume",
  };
}
