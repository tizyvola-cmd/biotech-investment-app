/**
 * News Thermometer layout (−1 … +1).
 * Clinical | Financial | Market Access — stacked rows with star markers.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  applyManualAxisScore,
  applyStoredCorrections,
  formatThermometerScore,
  logThermometerCorrection,
  matchSourceTitle,
  scoreArticleThermometer,
  thermometerAxisLabel,
  thermometerColor,
  thermometerFromUnit,
  type TaxonomyDimsInput,
  type ThermometerArticleScore,
  type ThermometerAxis,
  type ThermometerAxisScore,
} from "../sheet/eisThermometer";

function scoreToPct(score: number): number {
  return ((Math.max(-1, Math.min(1, score)) + 1) / 2) * 100;
}

function shortAxisLabel(axis: ThermometerAxis): string {
  if (axis === "clinical") return "Clin";
  if (axis === "market_access") return "Access";
  return "Fin";
}

function StarBadge({
  confirmed,
  positive,
}: {
  confirmed: boolean;
  positive: boolean;
}) {
  const fill = positive ? "#059669" : "#e11d48";
  const ring = positive ? "border-emerald-500/55" : "border-rose-500/55";
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full border bg-white shadow-sm ${ring}`}
      aria-hidden
    >
      <span
        className="text-[13px] leading-none"
        style={
          confirmed
            ? { color: fill }
            : { color: "transparent", WebkitTextStroke: `1.25px ${fill}` }
        }
      >
        ★
      </span>
    </span>
  );
}

function AxisRow({
  axisScore,
  it,
  onChange,
  interactive,
  articleKey,
  showEmpty,
}: {
  axisScore: ThermometerAxisScore;
  it: boolean;
  interactive?: boolean;
  articleKey?: string | null;
  onChange?: (next: ThermometerAxisScore, meta: { confirmOnly: boolean }) => void;
  /** Show muted empty row instead of hiding. */
  showEmpty?: boolean;
}) {
  const score = axisScore.score;
  const active = axisScore.relevant || score != null;
  const fullLabel = thermometerAxisLabel(axisScore.axis, it);
  const short = shortAxisLabel(axisScore.axis);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const applyScore = (raw: number) => {
    if (!onChange) return;
    const next = thermometerFromUnit(raw);
    onChange(
      applyManualAxisScore(axisScore, next, { articleKey }),
      { confirmOnly: false },
    );
  };

  const handleBarClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!interactive || !onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const unit = Math.round((x * 2 - 1) * 100) / 100;
    applyScore(unit);
  };

  const openEditor = () => {
    if (!interactive || !onChange) return;
    setDraft(
      score != null && Number.isFinite(score)
        ? (Math.round(score * 100) / 100).toFixed(2)
        : "0.00",
    );
    setEditing(true);
  };

  const commitEditor = () => {
    const parsed = Number(String(draft).replace(",", ".").trim());
    setEditing(false);
    if (!Number.isFinite(parsed)) return;
    applyScore(Math.max(-1, Math.min(1, parsed)));
  };

  if (!active && !showEmpty) return null;

  const color = thermometerColor(score);
  const confirmed = axisScore.confidence === "confirmed";
  const positive = (score ?? 0) >= 0;
  const pct = score != null ? scoreToPct(score) : 50;
  const matchTitle = matchSourceTitle(axisScore.matchSource, it);
  const tip = [fullLabel, matchTitle, axisScore.evidence || ""]
    .filter(Boolean)
    .join("\n");

  if (!active && showEmpty) {
    return (
      <div className="flex items-start gap-3 py-1.5 opacity-55">
        <div className="w-14 shrink-0 pt-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            {short}
          </div>
          <div className="text-[9px] text-ink-muted leading-tight">{fullLabel}</div>
        </div>
        {editing ? (
          <div className="ml-auto flex items-center gap-1">
            <input
              ref={inputRef}
              type="number"
              step="0.01"
              min={-1}
              max={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEditor}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEditor();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-[12px] font-bold tabular-nums text-slate-900 outline-none opacity-100"
              aria-label={it ? "Score −1…+1" : "Score −1…+1"}
            />
          </div>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-[10px] italic text-ink-muted leading-snug pt-1">
              {it
                ? "nessun evento rilevante in questo articolo — asse nascosto in vista compatta"
                : "no relevant event in this article — axis hidden in compact view"}
            </p>
            {interactive ? (
              <button
                type="button"
                className="shrink-0 text-ink-muted hover:text-ink p-0.5 mt-0.5"
                title={it ? "Imposta score manualmente" : "Set score manually"}
                onClick={openEditor}
                aria-label={it ? "Modifica score" : "Edit score"}
              >
                <PencilIcon />
              </button>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-1.5" title={tip || undefined}>
      <div className="w-14 shrink-0">
        <div className="text-[11px] font-bold uppercase tracking-wide text-ink">
          {short}
        </div>
        <div className="text-[9px] text-ink-muted leading-tight">{fullLabel}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div
          role={interactive ? "slider" : "img"}
          aria-label={`${fullLabel} ${formatThermometerScore(score)}`}
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={score ?? undefined}
          className={`relative h-2.5 rounded-full ${
            interactive ? "cursor-pointer" : ""
          }`}
          style={{
            background:
              "linear-gradient(90deg, #f5b4ae 0%, #f3f4f6 48%, #f3f4f6 52%, #9fd9b8 100%)",
          }}
          onClick={handleBarClick}
        >
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300/90 pointer-events-none" />
          {score != null ? (
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
              style={{ left: `${pct}%` }}
            >
              <StarBadge confirmed={confirmed} positive={positive} />
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex justify-between text-[8px] tabular-nums text-ink-muted px-0.5">
          <span>−1</span>
          <span>0</span>
          <span>+1</span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 min-w-[4.5rem] justify-end">
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            min={-1}
            max={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEditor}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEditor();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-[12px] font-bold tabular-nums text-slate-900 outline-none"
            aria-label={it ? "Score −1…+1" : "Score −1…+1"}
          />
        ) : (
          <>
            <span
              className="text-[13px] font-bold tabular-nums"
              style={{ color }}
            >
              {formatThermometerScore(score)}
            </span>
            {interactive ? (
              <button
                type="button"
                className="text-ink-muted hover:text-ink p-0.5 rounded hover:bg-slate-100"
                title={it ? "Modifica score (−1…+1)" : "Edit score (−1…+1)"}
                onClick={(e) => {
                  e.stopPropagation();
                  openEditor();
                }}
                aria-label={it ? "Modifica score" : "Edit score"}
              >
                <PencilIcon />
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

const ALL_AXES: ThermometerAxis[] = ["clinical", "financial", "market_access"];

export function EisThermometerPanel({
  taxonomy,
  articleKey,
  it,
  interactive = true,
  forceShow = false,
  className,
  onScoresChange,
}: {
  taxonomy: TaxonomyDimsInput;
  articleKey?: string | null;
  it: boolean;
  interactive?: boolean;
  /** Brief modal: show empty axes as muted rows instead of inventing 0 scores. */
  forceShow?: boolean;
  className?: string;
  onScoresChange?: (scores: ThermometerArticleScore) => void;
}) {
  const base = useMemo(() => scoreArticleThermometer(taxonomy), [taxonomy]);
  const keyed = String(articleKey || "").trim();
  const [override, setOverride] = useState<ThermometerArticleScore | null>(null);

  useEffect(() => {
    setOverride(null);
  }, [keyed]);

  const scored = useMemo(() => {
    const withStore = keyed ? applyStoredCorrections(keyed, base) : base;
    return override ?? withStore;
  }, [base, keyed, override]);

  useEffect(() => {
    onScoresChange?.(scored);
  }, [scored, onScoresChange]);

  const axes = forceShow
    ? ALL_AXES
    : ALL_AXES.filter((axis) => {
        const s = scored[axis];
        return s.relevant || s.score != null;
      });
  if (!axes.length) return null;

  const onAxisChange =
    (axis: ThermometerAxis) =>
    (next: ThermometerAxisScore, meta: { confirmOnly: boolean }) => {
      const prev = scored[axis];
      if (keyed) {
        logThermometerCorrection({
          articleKey: keyed,
          axis,
          oldScore: prev.score,
          newScore: next.score ?? 0,
          confirmedOnly: meta.confirmOnly,
          correctedAt: new Date().toISOString(),
          matchSource: next.matchSource ?? prev.matchSource,
          benchmarkId: next.benchmarkId ?? null,
        });
      }
      setOverride({
        clinical: axis === "clinical" ? next : scored.clinical,
        financial: axis === "financial" ? next : scored.financial,
        market_access: axis === "market_access" ? next : scored.market_access,
      });
    };

  return (
    <section
      className={`eis-thermo-gloss rounded-xl px-3 py-2.5 ${className || ""}`}
      aria-label={it ? "Termometro news" : "News thermometer"}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            {it ? "Termometro" : "Thermometer"}
          </h4>
          <span className="text-[9px] tabular-nums text-ink-muted/80">
            −1 … +1
          </span>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 text-[9px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <span className="text-[#34D399] text-[11px] leading-none">★</span>
            {it ? "Confermato" : "Confirmed"}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="text-[11px] leading-none"
              style={{
                color: "transparent",
                WebkitTextStroke: "1.1px #97A2BA",
              }}
            >
              ★
            </span>
            {it ? "Stima AI" : "AI estimate"}
          </span>
        </div>
      </div>

      <div className="divide-y divide-slate-200/80">
        {axes.map((axis) => (
          <AxisRow
            key={axis}
            axisScore={scored[axis]}
            it={it}
            interactive={interactive}
            articleKey={keyed || null}
            onChange={onAxisChange(axis)}
            showEmpty={forceShow}
          />
        ))}
      </div>
    </section>
  );
}
