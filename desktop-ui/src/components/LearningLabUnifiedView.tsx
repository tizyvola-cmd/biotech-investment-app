/**
 * Learning Lab v2 — unified taxonomy + grid view.
 *
 * Phase 1 of the redesign: read-only landing that enumerates EVERY
 * learning / calibration / feedback loop in the system (33+ today),
 * grouped by family (A magnitude · B pre-CD · C portfolio · D
 * monitoring). Each loop becomes a card with verdict pill, primary
 * metric, last run, and drill-down modal.
 *
 * Coexists with the redesigned `LearningLabView` (Monitor tab). Future phases:
 *   • Phase 2: cross-loop audit log tab ✓
 *   • Phase 3: portfolio_error_loop ✓
 *   • Phase 5: backend loops bayesian_shrinkage / proposal_engine / advice_feedback ✓
 *   • Phase 5: migrate the frontend-only loops (Bayesian shrinkage, RA
 *     calib, advice fb, MIG, …) to backend so they show real status here
 *     instead of the "frontend_localstorage" placeholder.
 *
 * Endpoint contract: relies exclusively on
 *   GET /api/learning/health
 *   GET /api/learning/loops
 *   POST /api/learning/loops/{id}/preview|apply|reset
 *
 * No business logic lives here — just rendering + small status colour
 * mapping. All taxonomy comes from `prediction/learning_bus.py`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyLearningLoop,
  fetchLearningHealth,
  fetchLearningLoops,
  previewLearningLoop,
  resetLearningLoop,
  type FamilyHealthCounts,
  type LearningFamily,
  type LearningHealthOverview,
  type LearningVerdict,
  type LearningWeeklyMetric,
  type LoopActionResult,
  type LoopWithStatus,
} from "../api/learningBus";
import { AppModal } from "./AppModal";
import { LoopWeeklyMetricSparkline } from "./LearningLabAuditLogPanel";
import { useLang } from "../shared/i18n";

const FAMILY_ORDER: LearningFamily[] = [
  "A_magnitude",
  "B_pre_cd",
  "C_portfolio",
  "D_monitoring",
];

const FAMILY_LABEL: Record<LearningFamily, { en: string; it: string }> = {
  A_magnitude: { en: "A · Magnitude (post-CD)", it: "A · Magnitudo (post-CD)" },
  B_pre_cd: { en: "B · Pre-CD signals & curve", it: "B · Segnali pre-CD & curva" },
  C_portfolio: { en: "C · Portfolio / sizing / advice", it: "C · Portafoglio / sizing / advice" },
  D_monitoring: { en: "D · Monitoring & quality", it: "D · Monitoring & qualità" },
};

const FAMILY_HINT: Record<LearningFamily, { en: string; it: string }> = {
  A_magnitude: {
    en: "Correct post-CD magnitude bias (cluster CF · regime · global CF · …)",
    it: "Correggono il bias di magnitudo post-CD (cluster CF · regime · global CF · …)",
  },
  B_pre_cd: {
    en: "Pre-CD signals, curve layers, polygon match, EIS super score",
    it: "Segnali pre-CD, layer di curva, polygon match, EIS super score",
  },
  C_portfolio: {
    en: "Learn sizing weights, RA thresholds, advice multipliers",
    it: "Apprendono pesi di sizing, soglie RA, moltiplicatori advice",
  },
  D_monitoring: {
    en: "Describe model quality without auto-tuning anything",
    it: "Descrivono la qualità del modello senza auto-tunare nulla",
  },
};

const VERDICT_TONE: Record<LearningVerdict, string> = {
  improving:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  stable: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  collecting_data: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  not_helping: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  stalled: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  unknown: "bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-400",
};

const VERDICT_LABEL: Record<LearningVerdict, { en: string; it: string }> = {
  improving: { en: "Improving", it: "In miglioramento" },
  stable: { en: "Stable", it: "Stabile" },
  neutral: { en: "Neutral", it: "Neutro" },
  collecting_data: { en: "Collecting data", it: "Raccolta dati" },
  not_helping: { en: "Not helping", it: "Non aiuta" },
  stalled: { en: "Stalled", it: "Fermo" },
  unknown: { en: "Unknown", it: "Sconosciuto" },
};

const SCHEDULE_LABEL: Record<string, { en: string; it: string }> = {
  weekly_sunday: { en: "weekly · Sun", it: "settimanale · Dom" },
  post_refresh_daily: { en: "daily refresh", it: "refresh giornaliero" },
  every_refresh: { en: "every refresh", it: "ogni refresh" },
  every_30_days: { en: "every ~30 days", it: "ogni ~30 giorni" },
  every_pred_live: { en: "every live pred", it: "ogni pred live" },
  on_demand_user: { en: "on demand", it: "on demand" },
  frontend_localstorage: { en: "frontend · localStorage", it: "frontend · localStorage" },
};

/** Pretty "X min ago" / "Yh ago" relative timestamp. */
function timeAgo(iso: string | null, it: boolean): string {
  if (!iso) return it ? "mai" : "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return it ? `${secs}s fa` : `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return it ? `${mins}min fa` : `${mins}min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return it ? `${hours}h fa` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return it ? `${days}g fa` : `${days}d ago`;
}

function fmtMetric(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  let pretty: string;
  if (abs >= 100) pretty = value.toFixed(0);
  else if (abs >= 10) pretty = value.toFixed(1);
  else pretty = value.toFixed(2);
  return unit ? `${pretty} ${unit}`.trim() : pretty;
}

export function LearningLabUnifiedView({
  reloadToken = 0,
  weeklyMetrics = [],
}: {
  reloadToken?: number;
  weeklyMetrics?: LearningWeeklyMetric[];
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const [health, setHealth] = useState<LearningHealthOverview | null>(null);
  const [loops, setLoops] = useState<LoopWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);
  const [familyFilter, setFamilyFilter] = useState<LearningFamily | "all">("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchLearningHealth(), fetchLearningLoops()])
      .then(([h, l]) => {
        if (cancelled) return;
        setHealth(h);
        setLoops(l.loops);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const grouped = useMemo(() => {
    const out: Record<LearningFamily, LoopWithStatus[]> = {
      A_magnitude: [],
      B_pre_cd: [],
      C_portfolio: [],
      D_monitoring: [],
    };
    for (const lp of loops) out[lp.family].push(lp);
    return out;
  }, [loops]);

  const selectedLoop = useMemo(
    () => loops.find((l) => l.id === selectedLoopId) ?? null,
    [loops, selectedLoopId],
  );

  const refreshLoops = useCallback(async () => {
    const l = await fetchLearningLoops();
    setLoops(l.loops);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* ── Header · health overview ─────────────────────────────── */}
      <header className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {it ? "Learning Lab · vista unificata" : "Learning Lab · unified view"}
            </h2>
            <p className="text-[11px] text-ink-muted">
              {it
                ? `Tutti i ${loops.length || "—"} loop di learning del sistema in un colpo solo`
                : `All ${loops.length || "—"} learning loops in one place`}
              {health?.newest_run_at
                ? ` · ${it ? "ultimo run" : "newest run"} ${timeAgo(health.newest_run_at, it)}`
                : ""}
            </p>
          </div>
          {loading && (
            <span className="text-[10px] text-ink-muted italic">
              {it ? "caricamento…" : "loading…"}
            </span>
          )}
        </div>
        {error && (
          <div className="mt-2 rounded border border-rose-300/60 bg-rose-50/50 dark:bg-rose-900/20 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-200">
            {it ? "Errore caricamento" : "Load error"}: {error}
          </div>
        )}
        {health && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px]">
            <FilterChip
              active={familyFilter === "all"}
              onClick={() => setFamilyFilter("all")}
              label={it ? `Tutti · ${loops.length}` : `All · ${loops.length}`}
            />
            {health.by_family.map((fc) => (
              <FilterChip
                key={fc.family}
                active={familyFilter === fc.family}
                onClick={() =>
                  setFamilyFilter(familyFilter === fc.family ? "all" : fc.family)
                }
                label={`${familyShort(fc.family)} · ${fc.total}`}
                detail={
                  <FamilyHealthMini fc={fc} it={it} />
                }
              />
            ))}
          </div>
        )}
      </header>

      {/* ── Grid · 3 columns A/B/C (D collapsed in footer) ───────── */}
      {!loading && loops.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {FAMILY_ORDER.filter(
              (f) =>
                f !== "D_monitoring" &&
                (familyFilter === "all" || familyFilter === f),
            ).map((family) => (
              <FamilyColumn
                key={family}
                family={family}
                loops={grouped[family]}
                onOpen={setSelectedLoopId}
                it={it}
              />
            ))}
          </div>

          {/* Monitoring family — usually less critical, in its own row */}
          {(familyFilter === "all" || familyFilter === "D_monitoring") && (
            <FamilyColumn
              family="D_monitoring"
              loops={grouped.D_monitoring}
              onOpen={setSelectedLoopId}
              it={it}
              wide
            />
          )}
        </>
      )}

      {/* ── Drill-down modal ─────────────────────────────────────── */}
      <AppModal
        open={selectedLoop !== null}
        onClose={() => setSelectedLoopId(null)}
        aria-label="Loop detail"
        panelClassName="max-w-2xl w-full"
      >
        {selectedLoop && (
          <div className="bg-surface/95 rounded-lg border border-[rgb(var(--border))]/60 p-4 max-h-[85vh] overflow-y-auto">
            <LoopDetail
              loop={selectedLoop}
              onClose={() => setSelectedLoopId(null)}
              onRefresh={refreshLoops}
              it={it}
              weeklyMetrics={weeklyMetrics}
            />
          </div>
        )}
      </AppModal>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function FilterChip({
  active,
  onClick,
  label,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition ${
        active
          ? "border-sky-500/60 bg-sky-100/70 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100"
          : "border-[rgb(var(--border))]/60 bg-surface/60 text-ink-muted hover:text-ink hover:border-[rgb(var(--border))]"
      }`}
    >
      <span className="font-medium tabular-nums">{label}</span>
      {detail}
    </button>
  );
}

function FamilyHealthMini({
  fc,
  it,
}: {
  fc: FamilyHealthCounts;
  it: boolean;
}) {
  const parts: string[] = [];
  if (fc.active) parts.push(`${fc.active} ${it ? "attivi" : "active"}`);
  if (fc.collecting) parts.push(`${fc.collecting} ${it ? "racc." : "collecting"}`);
  if (fc.stalled) parts.push(`${fc.stalled} ${it ? "fermi" : "stalled"}`);
  if (fc.planned) parts.push(`${fc.planned} ${it ? "futuri" : "planned"}`);
  if (fc.frontend_only) parts.push(`${fc.frontend_only} frontend`);
  if (parts.length === 0) return null;
  return (
    <span className="text-[9.5px] text-ink-muted/80 normal-case font-normal">
      ({parts.join(" · ")})
    </span>
  );
}

function familyShort(f: LearningFamily): string {
  switch (f) {
    case "A_magnitude":
      return "A · Magnitudo";
    case "B_pre_cd":
      return "B · Pre-CD";
    case "C_portfolio":
      return "C · Portafoglio";
    case "D_monitoring":
      return "D · Monitor";
  }
}

function FamilyColumn({
  family,
  loops,
  onOpen,
  it,
  wide = false,
}: {
  family: LearningFamily;
  loops: LoopWithStatus[];
  onOpen: (id: string) => void;
  it: boolean;
  wide?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border border-[rgb(var(--border))]/60 bg-surface/30 p-2.5 ${
        wide ? "" : "flex flex-col"
      }`}
    >
      <header className="mb-2 px-1">
        <h3 className="text-xs font-semibold text-ink">
          {it ? FAMILY_LABEL[family].it : FAMILY_LABEL[family].en}
        </h3>
        <p className="text-[10px] text-ink-muted leading-snug">
          {it ? FAMILY_HINT[family].it : FAMILY_HINT[family].en}
        </p>
      </header>
      <div
        className={`grid gap-2 ${
          wide
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "grid-cols-1"
        }`}
      >
        {loops.map((lp) => (
          <LoopCard key={lp.id} loop={lp} onOpen={() => onOpen(lp.id)} it={it} />
        ))}
        {loops.length === 0 && (
          <p className="text-[11px] text-ink-muted italic px-1">
            {it ? "Nessun loop" : "No loops"}
          </p>
        )}
      </div>
    </section>
  );
}

function LoopCard({
  loop,
  onOpen,
  it,
}: {
  loop: LoopWithStatus;
  onOpen: () => void;
  it: boolean;
}) {
  const name = it ? loop.name_it : loop.name_en;
  const descr = it ? loop.description_it : loop.description_en;
  const verdict = loop.status.verdict;
  const verdictLabel = it ? VERDICT_LABEL[verdict].it : VERDICT_LABEL[verdict].en;
  const schedule = SCHEDULE_LABEL[loop.schedule] ?? {
    en: loop.schedule,
    it: loop.schedule,
  };
  const isPlanned = loop.planned;
  const isFrontend = loop.schedule === "frontend_localstorage";
  const isOrphan = !!loop.inactive_reason;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-md border border-[rgb(var(--border))]/50 bg-surface/60 hover:bg-surface/80 hover:border-[rgb(var(--border))] transition p-2.5 flex flex-col gap-1.5 min-h-[112px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0 flex-1">
          <h4 className="text-[12px] font-semibold text-ink truncate" title={name}>
            {name}
          </h4>
          <p
            className="text-[10px] text-ink-muted leading-snug line-clamp-2"
            title={descr}
          >
            {descr}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-medium ${VERDICT_TONE[verdict]}`}
        >
          {verdictLabel}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2 mt-auto pt-1 border-t border-[rgb(var(--border))]/30">
        <div className="flex flex-col gap-0.5">
          {loop.status.primary_metric ? (
            <span className="text-[11px] tabular-nums text-ink font-medium leading-tight">
              {fmtMetric(
                loop.status.primary_metric.value,
                loop.status.primary_metric.unit,
              )}
              <span className="text-[9px] text-ink-muted ml-1 normal-case">
                {loop.status.primary_metric.name}
              </span>
            </span>
          ) : (
            <span className="text-[10px] italic text-ink-muted">
              {it ? "Nessuna metrica" : "No metric"}
            </span>
          )}
          <span className="text-[9.5px] text-ink-muted leading-tight">
            {timeAgo(loop.status.last_run_at, it)}
            <span className="mx-1">·</span>
            {it ? schedule.it : schedule.en}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          {isPlanned && (
            <span className="text-[9px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200 px-1.5 rounded">
              ★ {it ? "in arrivo" : "planned"}
            </span>
          )}
          {isFrontend && (
            <span
              className="text-[9px] bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 px-1.5 rounded"
              title={it ? "Solo frontend (localStorage)" : "Frontend only (localStorage)"}
            >
              FE
            </span>
          )}
          {isOrphan && (
            <span
              className="text-[9px] bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 px-1.5 rounded"
              title={loop.inactive_reason ?? ""}
            >
              ⚠ {it ? "orfano" : "orphan"}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function LoopDetail({
  loop,
  onClose,
  onRefresh,
  it,
  weeklyMetrics = [],
}: {
  loop: LoopWithStatus;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  it: boolean;
  weeklyMetrics?: LearningWeeklyMetric[];
}) {
  const name = it ? loop.name_it : loop.name_en;
  const descr = it ? loop.description_it : loop.description_en;
  const verdict = loop.status.verdict;
  const schedule = SCHEDULE_LABEL[loop.schedule] ?? {
    en: loop.schedule,
    it: loop.schedule,
  };
  const [actionBusy, setActionBusy] = useState(false);
  const [actionResult, setActionResult] = useState<LoopActionResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasAnyAction = loop.has_preview || loop.has_apply || loop.has_reset;

  const runAction = async (kind: "preview" | "apply" | "reset") => {
    if (kind === "apply" || kind === "reset") {
      const msg = it
        ? kind === "apply"
          ? `Applicare modifiche per ${loop.id}?`
          : `Reset loop ${loop.id}?`
        : kind === "apply"
          ? `Apply changes for ${loop.id}?`
          : `Reset loop ${loop.id}?`;
      if (!window.confirm(msg)) return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const res =
        kind === "preview"
          ? await previewLearningLoop(loop.id)
          : kind === "apply"
            ? await applyLearningLoop(loop.id)
            : await resetLearningLoop(loop.id);
      setActionResult(res);
      if (!res.ok && (res.hint_it || res.hint_en)) {
        setActionError(it ? res.hint_it ?? res.error ?? "" : res.hint_en ?? res.error ?? "");
      } else if (!res.ok) {
        setActionError(res.error ?? (it ? "Azione fallita" : "Action failed"));
      } else if (kind !== "preview") {
        await onRefresh();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <>
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9.5px] uppercase tracking-wider text-ink-muted font-semibold">
              {familyShort(loop.family)}
            </span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-medium ${VERDICT_TONE[verdict]}`}
            >
              {it ? VERDICT_LABEL[verdict].it : VERDICT_LABEL[verdict].en}
            </span>
          </div>
          <h3 className="text-base font-semibold text-ink">{name}</h3>
          <p className="text-[11px] text-ink-muted mt-1 leading-snug max-w-prose">{descr}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted hover:text-ink text-lg leading-none p-1"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px] mb-3">
        <DetailField label={it ? "File principale" : "Primary file"}>
          <code className="text-[10px] text-ink-muted break-all">{loop.primary_file}</code>
        </DetailField>
        <DetailField label={it ? "Schedulazione" : "Schedule"}>
          {it ? schedule.it : schedule.en}
        </DetailField>
        <DetailField label={it ? "Ultimo run" : "Last run"}>
          {timeAgo(loop.status.last_run_at, it)}
          {loop.status.last_run_at && (
            <span className="text-[9.5px] text-ink-muted/70 ml-1">
              ({loop.status.last_run_at.replace("T", " ").replace("+00:00", " UTC")})
            </span>
          )}
        </DetailField>
        <DetailField label={it ? "N. campioni" : "N samples"}>
          {loop.status.n_samples ?? "—"}
        </DetailField>
        <DetailField label="Preview / Apply / Reset">
          <span className="font-mono text-[10px]">
            {loop.has_preview ? "✓" : "—"} / {loop.has_apply ? "✓" : "—"} /{" "}
            {loop.has_reset ? "✓" : "—"}
          </span>
        </DetailField>
        <DetailField label="API endpoint">
          {loop.api_endpoint ? (
            <code className="text-[10px] text-ink-muted break-all">{loop.api_endpoint}</code>
          ) : (
            <span className="text-ink-muted italic text-[10px]">
              {it ? "nessuno (interno)" : "none (internal)"}
            </span>
          )}
        </DetailField>
      </dl>

      {hasAnyAction ? (
        <section className="mb-3 rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 p-2.5 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {loop.has_preview ? (
              <button type="button" className="btn-ghost text-xs" disabled={actionBusy} onClick={() => void runAction("preview")}>
                Preview
              </button>
            ) : null}
            {loop.has_apply ? (
              <button type="button" className="btn-ghost text-xs" disabled={actionBusy} onClick={() => void runAction("apply")}>
                {it ? "Applica" : "Apply"}
              </button>
            ) : null}
            {loop.has_reset ? (
              <button type="button" className="btn-ghost text-xs text-negative" disabled={actionBusy} onClick={() => void runAction("reset")}>
                Reset
              </button>
            ) : null}
          </div>
          {actionError ? <p className="text-[10px] text-negative">{actionError}</p> : null}
          {actionResult?.note_it || actionResult?.note_en ? (
            <p className="text-[10px] text-ink-muted">{it ? actionResult.note_it : actionResult.note_en}</p>
          ) : null}
          {actionResult?.ok && actionResult.changes && actionResult.changes.length > 0 ? (
            <ul className="text-[10px] font-mono max-h-32 overflow-y-auto space-y-0.5 text-ink-muted">
              {actionResult.changes.map((c, i) => (
                <li key={i}>{JSON.stringify(c)}</li>
              ))}
            </ul>
          ) : actionResult?.ok && actionResult.changes?.length === 0 ? (
            <p className="text-[10px] text-ink-muted italic">
              {it ? "Nessuna modifica proposta." : "No proposed changes."}
            </p>
          ) : null}
        </section>
      ) : loop.schedule === "frontend_localstorage" ? (
        <p className="mb-3 text-[10px] text-ink-muted rounded border border-blue-500/20 bg-blue-500/5 px-2 py-1.5">
          {it
            ? "Loop frontend-only → Calibration Center (tab Portfolio)."
            : "Frontend-only loop → Calibration Center (Portfolio tab)."}
        </p>
      ) : null}

      {loop.downstream.length > 0 && (
        <section className="mb-3">
          <h4 className="text-[10.5px] uppercase tracking-wider text-ink-muted font-semibold mb-1">
            {it ? "A valle (downstream)" : "Downstream"}
          </h4>
          <div className="flex flex-wrap gap-1">
            {loop.downstream.map((d) => (
              <code
                key={d}
                className="text-[10px] bg-surface/60 border border-[rgb(var(--border))]/50 rounded px-1.5 py-0.5 text-ink"
              >
                {d}
              </code>
            ))}
          </div>
        </section>
      )}

      {loop.state_files.length > 0 && (
        <section className="mb-3">
          <h4 className="text-[10.5px] uppercase tracking-wider text-ink-muted font-semibold mb-1">
            {it ? "File di stato persistito" : "Persisted state files"}
          </h4>
          <ul className="text-[10px] text-ink-muted space-y-0.5 font-mono">
            {loop.state_files.map((sf) => (
              <li key={sf} className="break-all">
                {sf}
              </li>
            ))}
          </ul>
        </section>
      )}

      {loop.inactive_reason && (
        <div className="mb-3 rounded border border-amber-300/60 bg-amber-50/40 dark:bg-amber-900/20 p-2 text-[11px] text-amber-800 dark:text-amber-200">
          <strong>{it ? "Loop orfano:" : "Orphan loop:"}</strong> {loop.inactive_reason}
        </div>
      )}

      {loop.planned && (
        <div className="mb-3 rounded border border-violet-300/60 bg-violet-50/40 dark:bg-violet-900/20 p-2 text-[11px] text-violet-800 dark:text-violet-200">
          <strong>{it ? "★ Loop pianificato:" : "★ Planned loop:"}</strong>{" "}
          {it
            ? "questo loop è in roadmap per la Fase 3 del rifacimento Learning Lab."
            : "this loop is on the roadmap for Phase 3 of the Learning Lab redesign."}
        </div>
      )}

      {loop.status.message && (
        <div className="mb-3 rounded border border-[rgb(var(--border))]/50 bg-surface/40 p-2 text-[11px] text-ink-muted">
          {loop.status.message}
        </div>
      )}

      {weeklyMetrics.length >= 2 && loop.id === "cluster_cf" ? (
        <section className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LoopWeeklyMetricSparkline
            weekly={weeklyMetrics}
            dataKey="mae_after_cluster"
            label={it ? "MAE post-cluster (settimane)" : "Post-cluster MAE (weeks)"}
          />
          <LoopWeeklyMetricSparkline
            weekly={weeklyMetrics}
            dataKey="dir_after_cluster"
            label={it ? "Dir accuracy post-cluster" : "Post-cluster dir accuracy"}
            scale={100}
          />
        </section>
      ) : null}

      {weeklyMetrics.length >= 2 && loop.id === "regime_mult" ? (
        <section className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LoopWeeklyMetricSparkline
            weekly={weeklyMetrics}
            dataKey="mae_after_regime"
            label={it ? "MAE post-regime (settimane)" : "Post-regime MAE (weeks)"}
          />
          <LoopWeeklyMetricSparkline
            weekly={weeklyMetrics}
            dataKey="dir_after_regime"
            label={it ? "Dir accuracy post-regime" : "Post-regime dir accuracy"}
            scale={100}
          />
        </section>
      ) : null}

      {weeklyMetrics.length >= 2 && loop.id === "global_cf" ? (
        <section className="mb-3">
          <LoopWeeklyMetricSparkline
            weekly={weeklyMetrics}
            dataKey="global_cal_factor"
            label={it ? "Global cal_factor (v4) nel tempo" : "Global cal_factor (v4) over time"}
          />
        </section>
      ) : null}

      {loop.id === "portfolio_error_loop" && loop.status.raw_excerpt?.latest ? (
        <section className="mb-3 rounded border border-violet-500/20 bg-violet-500/5 p-2 text-[10px] text-ink-muted">
          {it ? "Ultimo snapshot" : "Latest snapshot"}:{" "}
          <span className="tabular-nums text-ink">
            {String(
              (loop.status.raw_excerpt.latest as Record<string, unknown>).weighted_vs_equal_delta_eur ?? "—",
            )}
            € Δ weighted−equal
          </span>
        </section>
      ) : null}

      {loop.status.raw_excerpt && Object.keys(loop.status.raw_excerpt).length > 0 && (
        <section>
          <h4 className="text-[10.5px] uppercase tracking-wider text-ink-muted font-semibold mb-1">
            {it ? "Stato grezzo (excerpt)" : "Raw state excerpt"}
          </h4>
          <pre className="text-[10px] bg-surface/60 border border-[rgb(var(--border))]/40 rounded p-2 overflow-x-auto text-ink-muted">
            {JSON.stringify(loop.status.raw_excerpt, null, 2)}
          </pre>
        </section>
      )}
    </>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[9.5px] uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="text-ink text-[11px]">{children}</dd>
    </div>
  );
}
