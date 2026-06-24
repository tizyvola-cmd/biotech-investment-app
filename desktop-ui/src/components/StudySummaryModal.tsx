import { useCallback, useEffect, useState } from "react";
import {
  fetchClinicalStudySummary,
  generateClinicalStudySummary,
  type ClinicalStudySummary,
} from "../api/supernova";

// ── Outcome badge ──────────────────────────────────────────────────────────────

const OUTCOME_META = {
  positive: { label: "Positive",  bg: "#dcfce7", color: "#15803d", icon: "✓" },
  negative: { label: "Negative",  bg: "#fee2e2", color: "#dc2626", icon: "✗" },
  mixed:    { label: "Mixed",     bg: "#fef9c3", color: "#b45309", icon: "~" },
  pending:  { label: "Pending",   bg: "#f1f5f9", color: "#475569", icon: "…" },
};

function OutcomeBadge({ outcome }: { outcome?: string }) {
  const meta = OUTCOME_META[(outcome ?? "pending") as keyof typeof OUTCOME_META] ?? OUTCOME_META.pending;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
      style={{ background: meta.bg, color: meta.color }}
    >
      {meta.icon} {meta.label}
    </span>
  );
}

// ── Quality badge ──────────────────────────────────────────────────────────────

function QualityBadge({ quality }: { quality?: string }) {
  if (!quality) return null;
  const colors: Record<string, { bg: string; color: string }> = {
    high:   { bg: "#dcfce7", color: "#15803d" },
    medium: { bg: "#fef9c3", color: "#b45309" },
    low:    { bg: "#f1f5f9", color: "#64748b" },
  };
  const c = colors[quality] ?? colors.low;
  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: c.bg, color: c.color }}>
      data {quality}
    </span>
  );
}

// ── Section card ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="study-summary-section rounded-xl border overflow-hidden">
      <div className="study-summary-section-head px-4 py-2 border-b">
        <p className="study-summary-section-label text-[11px] font-bold uppercase tracking-wider">{title}</p>
      </div>
      <div className="study-summary-section-body px-4 py-3 text-[13px] leading-relaxed">{children}</div>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

export function StudySummaryModal({
  nctId,
  ticker,
  company,
  briefTitle,
  onClose,
}: {
  nctId: string;
  ticker: string;
  company: string;
  briefTitle?: string | null;
  onClose: () => void;
}) {
  const [data, setData]     = useState<ClinicalStudySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async (forceGenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      // Try cache first unless forced
      if (!forceGenerate) {
        const cached = await fetchClinicalStudySummary(nctId);
        if (cached.ai && Object.keys(cached.ai).length > 0) {
          setData(cached);
          setLoading(false);
          return;
        }
      }
      // Generate fresh summary
      const result = await generateClinicalStudySummary(nctId, ticker, company);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [nctId, ticker, company]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const ai   = data?.ai ?? {};
  const meta = data?.meta ?? {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="study-summary-modal w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="study-summary-modal-head px-5 py-4 border-b flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="study-summary-modal-title text-[13px] font-extrabold shrink-0">{ticker}</span>
              <span className="study-summary-modal-nct text-[11px] font-mono shrink-0">{nctId}</span>
              {meta.phase && (
                <span className="clinical-chip text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0">
                  {meta.phase}
                </span>
              )}
              {meta.overall_status && (
                <span className="clinical-chip text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0">
                  {meta.overall_status}
                </span>
              )}
            </div>
            <p className="study-summary-modal-sub mt-1 text-[12px] leading-snug line-clamp-2">
              {meta.brief_title || briefTitle || company}
            </p>
            {meta.conditions && (
              <p className="study-summary-modal-meta text-[11px] mt-0.5">{meta.conditions}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="study-summary-modal-close shrink-0 text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">

          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <span className="text-3xl animate-spin">⏳</span>
              <p className="text-sm text-slate-500">
                Fetching CT.gov results + PubMed abstracts…
              </p>
              <p className="text-[11px] text-slate-400">This may take 15–25 seconds</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg px-4 py-3 text-[12px] text-red-700"
              style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
              {error}
            </div>
          )}

          {!loading && data && (
            <>
              {/* Outcome + quality */}
              <div className="flex items-center gap-2 flex-wrap">
                <OutcomeBadge outcome={ai.outcome} />
                <QualityBadge quality={ai.data_quality} />
                {!data.has_results && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full text-amber-700"
                    style={{ background: "#fef9c3" }}>
                    No results posted on CT.gov yet — summary based on metadata + publications
                  </span>
                )}
              </div>

              {/* Executive summary */}
              {ai.executive_summary && (
                <Section title="Summary">
                  {ai.executive_summary}
                </Section>
              )}

              {/* Efficacy */}
              {(ai.primary_endpoint || ai.key_metrics) && (
                <Section title="Efficacy">
                  {ai.primary_endpoint && (
                    <p className="mb-1">{ai.primary_endpoint}</p>
                  )}
                  {ai.key_metrics && (
                    <p className="font-mono text-[12px] px-2 py-1 rounded bg-white border border-slate-200 mt-1">
                      {ai.key_metrics}
                    </p>
                  )}
                </Section>
              )}

              {/* Safety */}
              {ai.safety_profile && (
                <Section title="Safety">
                  {ai.safety_profile}
                  {data.ae_summary && data.ae_summary.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                      {data.ae_summary.map((ae, i) => (
                        <li key={i} className="font-mono">• {ae}</li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {/* Patient population */}
              {(ai.patient_population || meta.enrollment) && (
                <Section title="Population">
                  {ai.patient_population || `${meta.enrollment ?? "?"} patients`}
                  {meta.interventions && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Regimen: {meta.interventions}
                    </p>
                  )}
                </Section>
              )}

              {/* Investment note */}
              {ai.investment_note && (
                <Section title="Investment Relevance">
                  <p className="font-medium text-slate-900">{ai.investment_note}</p>
                </Section>
              )}

              {/* Publications */}
              {((ai.key_publications?.length ?? 0) > 0 || (data.citations?.length ?? 0) > 0) && (
                <Section title="Key Publications">
                  <ul className="space-y-1.5">
                    {(ai.key_publications ?? data.citations ?? []).slice(0, 3).map((pub, i) => (
                      <li key={i} className="text-[11px] text-slate-600 leading-snug">
                        {data.pubmed_pmids?.[i] ? (
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${data.pubmed_pmids[i]}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {pub}
                          </a>
                        ) : pub}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Raw outcome measures (collapsed) */}
              {data.outcome_measures && data.outcome_measures.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600 select-none">
                    Raw outcome measures ({data.outcome_measures.length}) ▸
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {data.outcome_measures.map((om, i) => (
                      <div key={i} className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">
                        <span className="font-semibold text-slate-500 uppercase text-[9px]">
                          {om.type}
                        </span>
                        <p className="text-slate-700 mt-0.5">{om.title}</p>
                        {om.time_frame && (
                          <p className="text-slate-400 text-[10px]">{om.time_frame}</p>
                        )}
                        {om.values && om.values.length > 0 && (
                          <p className="font-mono text-slate-600 mt-1">
                            {om.values.slice(0, 4).join(" · ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between"
          style={{ background: "#f8fafc" }}>
          <div className="flex items-center gap-2">
            {data?.generated_at && !loading && (
              <span className="text-[10px] text-slate-400">
                Generated {new Date(data.generated_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!loading && (
              <button
                type="button"
                onClick={() => void load(true)}
                className="text-[11px] text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-white transition"
              >
                Regenerate
              </button>
            )}
            <a
              href={`https://clinicaltrials.gov/study/${nctId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-600 hover:underline font-medium"
            >
              CT.gov ↗
            </a>
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg transition"
              style={{ background: "#1d4ed8", color: "#ffffff" }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
