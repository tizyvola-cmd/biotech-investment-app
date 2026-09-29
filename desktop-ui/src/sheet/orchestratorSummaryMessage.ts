import type { OrchestratorRunSummary } from "../api/refresh";

/** Metadata incoerente (es. avvio = fine ma durata ore) — run non affidabile. */
export function isCorruptOrchestratorSummary(
  doc: OrchestratorRunSummary | null | undefined,
): boolean {
  if (!doc) return false;
  const elapsed = Math.max(0, Math.round(doc.elapsed_sec ?? 0));
  if (elapsed < 3600) return false;
  const started = (doc.started_at_display || doc.started_at || "").trim();
  const finished = (doc.finished_at_display || doc.finished_at || "").trim();
  if (!started || !finished) return false;
  return started === finished;
}

/** Mirrors ``orchestrator_run_summary.format_summary_message`` for UI locale. */
export function formatOrchestratorSummaryMessage(
  doc: OrchestratorRunSummary | null | undefined,
  lang: "en" | "it",
): string {
  if (!doc || Object.keys(doc).length === 0) return "";

  const it = lang === "it";
  const ok = Boolean(doc.ok);
  const finished = doc.finished_at_display || doc.finished_at || "—";
  const started = doc.started_at_display || doc.started_at || "—";
  const elapsed = Math.max(0, Math.round(doc.elapsed_sec ?? 0));
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const dur = m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;

  const lines: string[] = [];
  if (ok) {
    lines.push(
      it
        ? `Orchestrator completato alle ${finished} (durata ${dur}, avvio ${started}).`
        : `Orchestrator finished at ${finished} (duration ${dur}, started ${started}).`,
    );
  } else {
    lines.push(
      it
        ? `Orchestrator terminato con errori alle ${finished} (durata ${dur}).`
        : `Orchestrator ended with errors at ${finished} (duration ${dur}).`,
    );
  }

  const allNew = [
    ...new Set([
      ...(doc.new_tickers_discovery ?? []),
      ...(doc.new_tickers_extra ?? []),
      ...(doc.new_tickers_ipo ?? []),
    ]),
  ].sort();
  if (allNew.length > 0) {
    let preview = allNew.slice(0, 12).join(", ");
    if (allNew.length > 12) preview += ` (+${allNew.length - 12})`;
    lines.push(
      it
        ? `Nuovi ticker biotech: ${allNew.length} — ${preview}`
        : `New biotech tickers: ${allNew.length} — ${preview}`,
    );
  } else {
    lines.push(
      it
        ? "Nessun nuovo ticker nell'universo (discovery/extra)."
        : "No new tickers in universe (discovery/extra).",
    );
  }

  const newCd = doc.new_catalyst_rows ?? [];
  if (newCd.length > 0) {
    lines.push(
      it
        ? `Nuove CD registrate (Exact/Partial, rel. diretta/collab./subsidiary): ${newCd.length}`
        : `New catalyst dates (Exact/Partial, direct/collab./subsidiary rel.): ${newCd.length}`,
    );
    for (const ent of newCd.slice(0, 8)) {
      const tk = ent.ticker || "?";
      const cd = ent.completion_date || "?";
      const sm = ent.sponsor_match || "?";
      const rel = ent.nct_relation_type || "?";
      const co = (ent.company || "").slice(0, 28);
      const sp = (ent.sponsor || "").slice(0, 28);
      lines.push(`  · ${tk} CD ${cd} — ${sm} · ${rel} · ${co} ↔ ${sp}`);
    }
    if (newCd.length > 8) {
      lines.push(
        it ? `  … +${newCd.length - 8} altre` : `  … +${newCd.length - 8} more`,
      );
    }
  } else {
    lines.push(
      it
        ? "Nessuna nuova coppia ticker|CD in coorte rispetto al run precedente."
        : "No new ticker|CD pairs in cohort vs previous run.",
    );
  }

  const staged = doc.staged_workbook?.trim();
  if (staged) {
    const base = staged.split(/[/\\]/).pop() || staged;
    lines.push(`Staged: ${base}`);
  }

  return lines.join(" ");
}

/** True if ``message`` looks like orchestrator summary (stored in refresh_fast_status). */
export function isOrchestratorSummaryMessage(message: string | undefined): boolean {
  const m = (message ?? "").trim();
  if (!m) return false;
  return (
    m.startsWith("Orchestrator completato") ||
    m.startsWith("Orchestrator finished") ||
    m.startsWith("Orchestrator terminato") ||
    m.startsWith("Orchestrator ended")
  );
}
