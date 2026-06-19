/**
 * Calibration Center — review queue + history + sizing preview.
 *
 * Read-only view of the Bayesian shrinkage engine state. The actions are:
 *  - "Compute now" → recomputes a fresh proposal from the latest outcomes.
 *  - "Approve" / "Reject" / "Reject with note" on pending proposals.
 *
 * Nothing happens to frozen weights until the user explicitly clicks Approve.
 */
import { useCallback, useMemo, useState } from "react";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { useLang } from "../shared/i18n";
import {
  generateProposalFromOutcomes,
  approveProposal,
  rejectProposal,
} from "../calibration/proposalEngine";
import {
  listProposals,
  loadFrozenWeights,
} from "../calibration/proposalStore";
import type {
  CalibrationDimension,
  CalibrationProposal,
  ConfidenceLevel,
  ProposalChange,
  ProposalStatus,
} from "../calibration/calibrationTypes";

const DIM_LABEL_IT: Record<CalibrationDimension, string> = {
  clinicalPhase: "Fase clinica",
  clinicalIndication: "Indicazione",
  sdsBucket: "SDS bucket",
  pplanBucket: "P(plan) bucket",
};
const DIM_LABEL_EN: Record<CalibrationDimension, string> = {
  clinicalPhase: "Clinical phase",
  clinicalIndication: "Indication",
  sdsBucket: "SDS bucket",
  pplanBucket: "P(plan) bucket",
};

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const conf = {
    low: { bg: "#dc26261a", border: "#dc262655", color: "#b91c1c", label: "LOW" },
    medium: {
      bg: "#f59e0b1a",
      border: "#f59e0b55",
      color: "#b45309",
      label: "MED",
    },
    high: { bg: "#0596691a", border: "#05966955", color: "#047857", label: "HIGH" },
  }[level];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums"
      style={{
        backgroundColor: conf.bg,
        border: `1px solid ${conf.border}`,
        color: conf.color,
      }}
    >
      {conf.label}
    </span>
  );
}

function StatusBadge({ status }: { status: ProposalStatus }) {
  const styles = {
    pending: {
      bg: "#3b82f61a",
      border: "#3b82f655",
      color: "#1d4ed8",
      label: "PENDING",
    },
    approved: {
      bg: "#0596691a",
      border: "#05966955",
      color: "#047857",
      label: "APPROVED",
    },
    rejected: {
      bg: "#64748b1a",
      border: "#64748b55",
      color: "#475569",
      label: "REJECTED",
    },
  }[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{
        backgroundColor: styles.bg,
        border: `1px solid ${styles.border}`,
        color: styles.color,
      }}
    >
      {styles.label}
    </span>
  );
}

function ChangeRow({
  c,
  dimLabel,
}: {
  c: ProposalChange;
  dimLabel: string;
}) {
  const dirColor =
    c.delta > 0 ? "text-emerald-700" : c.delta < 0 ? "text-rose-700" : "text-ink";
  return (
    <tr className="border-b border-[rgb(var(--border))]/30 align-top">
      <td className="py-2 pr-2 text-[11px] font-medium text-ink">{dimLabel}</td>
      <td className="py-2 px-2 text-[11px] text-ink">{c.cell}</td>
      <td className="py-2 px-2 text-right tabular-nums text-[11px]">
        {fmtPct(c.oldWeight)}
      </td>
      <td className="py-2 px-2 text-right tabular-nums text-[11px] font-semibold text-ink">
        {fmtPct(c.newWeight)}
      </td>
      <td className={`py-2 px-2 text-right tabular-nums text-[11px] font-semibold ${dirColor}`}>
        {c.delta >= 0 ? "+" : ""}
        {(c.delta * 100).toFixed(1)}pp
      </td>
      <td className="py-2 px-2 text-right tabular-nums text-[10px] text-ink-muted">
        {c.oldN} → {c.newN}
      </td>
      <td className="py-2 px-2 text-center">
        <div className="flex items-center justify-center gap-1">
          <ConfidenceBadge level={c.oldConfidence} />
          <span className="text-ink-muted">→</span>
          <ConfidenceBadge level={c.newConfidence} />
          {c.confidenceChanged ? (
            <span title="Confidence level changed" className="ml-1 text-amber-600 text-[10px]">
              ⚠
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-2 pl-2 text-[10px] text-ink-muted leading-snug max-w-[320px]">
        {c.rationale}
      </td>
    </tr>
  );
}

function ProposalCard({
  proposal,
  it,
  onApprove,
  onReject,
}: {
  proposal: CalibrationProposal;
  it: boolean;
  onApprove: (id: string, note?: string) => void;
  onReject: (id: string, note?: string) => void;
}) {
  const [note, setNote] = useState("");
  const dimLabel = it ? DIM_LABEL_IT : DIM_LABEL_EN;
  const confidenceFlags = proposal.changes.filter((c) => c.confidenceChanged).length;

  return (
    <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel-bg))] p-4">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <StatusBadge status={proposal.status} />
          <span className="text-[11px] text-ink-muted">
            {new Date(proposal.createdAt).toLocaleString()}
          </span>
          {proposal.triggeredByTradeId ? (
            <span className="text-[10px] text-ink-muted">
              · {it ? "trigger" : "triggered by"}:{" "}
              <code className="text-[10px]">{proposal.triggeredByTradeId}</code>
            </span>
          ) : (
            <span className="text-[10px] text-ink-muted italic">
              {it ? "ricalcolo manuale" : "manual recompute"}
            </span>
          )}
          {confidenceFlags > 0 ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
              ⚠ {confidenceFlags} {it ? "cambi confidence" : "confidence changes"}
            </span>
          ) : null}
        </div>
        <div className="text-[10px] text-ink-muted">
          {proposal.changes.length} {it ? "modifiche" : "changes"}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-[rgb(var(--border))]/60 text-ink-muted">
              <th className="text-left font-semibold pb-2 pr-2">{it ? "Dimensione" : "Dimension"}</th>
              <th className="text-left font-semibold pb-2 px-2">{it ? "Cella" : "Cell"}</th>
              <th className="text-right font-semibold pb-2 px-2">{it ? "Vecchio" : "Old"}</th>
              <th className="text-right font-semibold pb-2 px-2">{it ? "Nuovo" : "New"}</th>
              <th className="text-right font-semibold pb-2 px-2">Δ</th>
              <th className="text-right font-semibold pb-2 px-2">n</th>
              <th className="text-center font-semibold pb-2 px-2">Conf</th>
              <th className="text-left font-semibold pb-2 pl-2">{it ? "Razionale" : "Rationale"}</th>
            </tr>
          </thead>
          <tbody>
            {proposal.changes.map((c, i) => (
              <ChangeRow key={i} c={c} dimLabel={dimLabel[c.dimension]} />
            ))}
          </tbody>
        </table>
      </div>

      {proposal.status === "pending" ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={it ? "Nota di revisione (opzionale)" : "Review note (optional)"}
            className="flex-1 min-w-[200px] text-[11px] px-2 py-1.5 rounded border border-[rgb(var(--border))] bg-[rgb(var(--panel-bg))] text-ink"
          />
          <button
            onClick={() => onApprove(proposal.id, note || undefined)}
            className="px-3 py-1.5 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
          >
            {it ? "✓ Approva" : "✓ Approve"}
          </button>
          <button
            onClick={() => onReject(proposal.id, note || undefined)}
            className="px-3 py-1.5 rounded text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors"
          >
            {it ? "✕ Rifiuta" : "✕ Reject"}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-muted">
          <span>
            {it ? "Revisionato il" : "Reviewed at"}{" "}
            {proposal.reviewedAt
              ? new Date(proposal.reviewedAt).toLocaleString()
              : "—"}
          </span>
          {proposal.reviewNote ? (
            <span className="italic">
              · {it ? "Nota" : "Note"}: "{proposal.reviewNote}"
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

type Tab = "queue" | "history" | "frozen";

export function CalibrationCenterView({
  outcomes,
  simTable,
  sdsRows,
}: {
  outcomes: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const [tab, setTab] = useState<Tab>("queue");
  const [proposals, setProposals] = useState<CalibrationProposal[]>(() =>
    listProposals(),
  );

  const frozen = useMemo(() => loadFrozenWeights(), [proposals]);

  const computeNow = useCallback(() => {
    const result = generateProposalFromOutcomes(
      outcomes,
      {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      },
      { lang: it ? "it" : "en" },
    );
    setProposals(listProposals());
    if (!result.proposal) {
      window.alert(
        it
          ? "Nessuna modifica significativa rispetto ai pesi congelati."
          : "No meaningful change vs frozen weights.",
      );
    }
  }, [outcomes, simTable, sdsRows, it]);

  const handleApprove = useCallback(
    (id: string, note?: string) => {
      approveProposal(id, note);
      setProposals(listProposals());
    },
    [],
  );

  const handleReject = useCallback(
    (id: string, note?: string) => {
      rejectProposal(id, note);
      setProposals(listProposals());
    },
    [],
  );

  const pending = proposals.filter((p) => p.status === "pending");
  const history = proposals.filter((p) => p.status !== "pending");

  return (
    <div className="space-y-4">
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0">⚖️</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-ink">
              {it
                ? "Centro di calibrazione (Bayesian shrinkage)"
                : "Calibration center (Bayesian shrinkage)"}
            </h3>
            <p className="text-[11px] text-ink-muted leading-relaxed mt-1">
              {it
                ? "Stima onesta del win rate per dimensione (fase, indicazione, SDS, P(plan)) anche a basso n. Mai un numero senza il suo n e la sua confidence. Le proposte sono in coda — i pesi cambiano solo quando approvi."
                : "Honest win-rate estimate per dimension (phase, indication, SDS, P(plan)) even at low n. Never a naked number — every value carries n and confidence. Proposals queue up; weights only change when you approve."}
            </p>
          </div>
          <button
            onClick={computeNow}
            className="shrink-0 px-3 py-1.5 rounded text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            {it ? "Ricalcola ora" : "Compute now"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[rgb(var(--border))]/60">
        {(
          [
            { id: "queue", label: it ? `Coda (${pending.length})` : `Queue (${pending.length})` },
            { id: "frozen", label: it ? "Pesi approvati" : "Approved weights" },
            {
              id: "history",
              label: it ? `Storico (${history.length})` : `History (${history.length})`,
            },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-[11px] font-semibold border-b-2 transition-colors ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "queue" ? (
        pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[rgb(var(--border))] p-6 text-center text-[11px] text-ink-muted">
            {it
              ? "Nessuna proposta in coda. Clicca «Ricalcola ora» dopo nuovi trade chiusi per generarne una."
              : "No pending proposals. Click 'Compute now' after new closed trades to generate one."}
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                it={it}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )
      ) : null}

      {tab === "frozen" ? (
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel-bg))] p-4">
          <div className="text-[11px] text-ink-muted mb-3">
            {it
              ? `Pesi attualmente approvati — questi sono gli unici che alimentano sizingRules.ts. Ultimo aggiornamento: ${new Date(frozen.updatedAt).toLocaleString()}.`
              : `Currently approved weights — the only set consumed by sizingRules.ts. Last updated: ${new Date(frozen.updatedAt).toLocaleString()}.`}
          </div>
          {(Object.keys(frozen.weights) as CalibrationDimension[]).every(
            (d) => Object.keys(frozen.weights[d]).length === 0,
          ) ? (
            <div className="text-center text-[11px] text-ink-muted italic py-4">
              {it
                ? "Nessun peso approvato ancora. Approva una proposta per popolare questa vista."
                : "No approved weights yet. Approve a proposal to populate this view."}
            </div>
          ) : (
            (Object.keys(frozen.weights) as CalibrationDimension[]).map((dim) => {
              const cells = Object.entries(frozen.weights[dim]);
              if (cells.length === 0) return null;
              return (
                <div key={dim} className="mb-4">
                  <h4 className="text-[12px] font-bold text-ink mb-2">
                    {(it ? DIM_LABEL_IT : DIM_LABEL_EN)[dim]}
                  </h4>
                  <table className="w-full text-[11px] table-fixed">
                    <colgroup>
                      <col style={{ width: "55%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "15%" }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-[rgb(var(--border))]/60 text-ink-muted">
                        <th className="text-left font-semibold pb-1.5 pr-2">{it ? "Cella" : "Cell"}</th>
                        <th className="text-right font-semibold pb-1.5 px-2">{it ? "Peso" : "Weight"}</th>
                        <th className="text-right font-semibold pb-1.5 px-2">n</th>
                        <th className="text-center font-semibold pb-1.5 pl-2">Conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cells.map(([cellName, w]) => (
                        <tr key={cellName} className="border-b border-[rgb(var(--border))]/30">
                          <td className="py-1.5 pr-2 text-ink truncate" title={cellName}>
                            {cellName}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-ink">
                            {fmtPct(w.weight)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-ink-muted">
                            {w.n}
                          </td>
                          <td className="py-1.5 pl-2 text-center">
                            <ConfidenceBadge level={w.confidence} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {tab === "history" ? (
        history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[rgb(var(--border))] p-6 text-center text-[11px] text-ink-muted">
            {it
              ? "Nessuna proposta revisionata ancora."
              : "No reviewed proposals yet."}
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                it={it}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
