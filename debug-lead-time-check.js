// Incolla nella DevTools Console con l'app aperta (F12 → Console)
// Verifica che recordTradeLeadTimes stia salvando dati corretti (Phase 2).
//
// Dipende da: invest_trade_lead_times_v1 (Phase 2)
//             invest_pattern_match_state_v1 (Phase 1 — per contesto)
//             invest_decision_sim_v1 (per storico trade SELL)
(() => {
  // ── 1. Log lead-time ────────────────────────────────────────────────────
  const rawLt = localStorage.getItem("invest_trade_lead_times_v1");
  const records = rawLt ? JSON.parse(rawLt) : [];

  console.log("═══ Lead-time records (invest_trade_lead_times_v1) ══════════");
  if (!records.length) {
    console.warn("❌ Nessun record trovato.");
    console.warn("   Cause possibili:");
    console.warn("   • Nessun SELL trade eseguito ancora dopo il deploy di Phase 2");
    console.warn("   • Il SELL ha chiuso una posizione che NON era in match (nessun lead-time da registrare)");
    console.warn("   • Controlla il match state corrente con debug-pattern-match-check.js");
  } else {
    console.log(`✅ ${records.length} record/i trovati:\n`);
    console.table(
      records.map((r) => ({
        ticker:       r.ticker,
        closedAt:     r.closedAt?.slice(0, 16),
        matchStart:   r.matchStartAt?.slice(0, 16),
        leadH:        r.leadTimeHours,
        pnlEur:       r.pnlEurSimulated,
        pnlPct:       r.pnlPctSimulated != null ? r.pnlPctSimulated.toFixed(2) + "%" : null,
        capital:      r.capital,
        patternId:    r.patternId?.slice(0, 20) + "…",
        tradeId:      r.tradeId?.slice(0, 30),
      }))
    );
  }

  // ── 2. Cross-check con ticks SELL ───────────────────────────────────────
  const rawSim = localStorage.getItem("invest_decision_sim_v1");
  const ticks = rawSim ? (JSON.parse(rawSim)?.ticks ?? []) : [];
  const allSells = ticks.flatMap((tk) =>
    (tk.trades ?? [])
      .filter((tr) => tr.side === "sell")
      .map((tr) => ({ ...tr, tickAt: tk.at }))
  );

  console.log("\n═══ Tutti i SELL nel storico tick ══════════════════════════");
  if (!allSells.length) {
    console.log("📭 Nessun SELL nel storico tick — non ci sono ancora dati lead-time.");
  } else {
    const ltByTradeId = new Map(records.map((r) => [r.tradeId, r]));
    console.table(
      allSells.map((tr) => {
        const tradeId = `${tr.at ?? tr.tickAt}|${tr.key}`;
        const lt = ltByTradeId.get(tradeId);
        return {
          ticker:      tr.ticker,
          at:          (tr.at ?? tr.tickAt)?.slice(0, 16),
          pnlEur:      tr.pnlEurSimulated,
          hasLeadTime: lt ? `✅ ${lt.leadTimeHours}h` : "— no match al momento",
        };
      })
    );

    const sellsWithLt  = allSells.filter((tr) => ltByTradeId.has(`${tr.at ?? tr.tickAt}|${tr.key}`));
    const sellsNoLt    = allSells.filter((tr) => !ltByTradeId.has(`${tr.at ?? tr.tickAt}|${tr.key}`));
    console.log(`\nSELL con lead-time registrato:   ${sellsWithLt.length}`);
    console.log(`SELL senza lead-time (no match): ${sellsNoLt.length}`);
  }

  // ── 3. Sanity check sui valori ───────────────────────────────────────────
  if (records.length > 0) {
    console.log("\n═══ Sanity checks ═══════════════════════════════════════════");
    const negLt = records.filter((r) => r.leadTimeMs < 0);
    if (negLt.length) {
      console.error(`❌ ${negLt.length} record con leadTimeMs NEGATIVO — bug!`);
      console.table(negLt);
    } else {
      console.log("✅ Tutti i leadTimeMs ≥ 0");
    }
    const missingFields = records.filter(
      (r) => !r.rowKey || !r.patternId || !r.matchStartAt || !r.closedAt
    );
    if (missingFields.length) {
      console.warn(`⚠️  ${missingFields.length} record con campi mancanti`);
    } else {
      console.log("✅ Tutti i campi obbligatori presenti");
    }
    const dupIds = records
      .map((r) => r.tradeId)
      .filter((id, i, arr) => arr.indexOf(id) !== i);
    if (dupIds.length) {
      console.warn(`⚠️  ${dupIds.length} tradeId duplicati (dedup fallito?):`, dupIds);
    } else {
      console.log("✅ Nessun tradeId duplicato");
    }
  }

  console.log("\n═════════════════════════════════════════════════════════════");
  console.log("Per dati Phase 1 (match state corrente): debug-pattern-match-check.js");
})();
