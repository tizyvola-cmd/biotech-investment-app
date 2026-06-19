// Incolla nella DevTools Console con l'app aperta (F12 → Console)
// Verifica che updatePatternMatchState stia salvando dati corretti.
//
// Dipende da: invest_pattern_match_state_v1 (Phase 1)
//             supernova.riskPattern.approved.v1 (pattern approvato)
//             invest_decision_sim_v1 (portfolio aperto ultimo tick)
(() => {
  // ── 1. Pattern approvato ────────────────────────────────────────────────
  const rawPattern = localStorage.getItem("supernova.riskPattern.approved.v1");
  const approvedRecord = rawPattern ? JSON.parse(rawPattern) : null;
  const pattern = approvedRecord?.current ?? null;

  console.log("═══ Pattern approvato ═══════════════════════════════════════");
  if (!pattern) {
    console.warn("⚠️  Nessun pattern approvato trovato in supernova.riskPattern.approved.v1");
    console.warn("   updatePatternMatchState non scriverà nulla finché non c'è un pattern.");
  } else {
    console.log(`✅ Pattern: "${pattern.name ?? pattern.id}"`);
    console.log(`   id:          ${pattern.id}`);
    console.log(`   approvedAt:  ${pattern.approvedAt ?? "(manca)"}`);
    console.log(`   condizioni:  ${JSON.stringify(pattern.conditions)}`);
  }

  // ── 2. Stato match (chiave Phase 1) ─────────────────────────────────────
  const rawMatch = localStorage.getItem("invest_pattern_match_state_v1");
  const matchState = rawMatch ? JSON.parse(rawMatch) : null;

  console.log("\n═══ Stato match (invest_pattern_match_state_v1) ═════════════");
  if (!rawMatch) {
    console.warn("❌ Chiave invest_pattern_match_state_v1 NON trovata.");
    console.warn("   Possibili cause:");
    console.warn("   • Nessun tick è ancora stato eseguito dopo il deploy di Phase 1");
    console.warn("   • Il portfolio è vuoto (nessuna posizione aperta)");
    console.warn("   • Nessun pattern approvato (vedi sopra)");
  } else if (!matchState || Object.keys(matchState).length === 0) {
    console.log("📭 Chiave presente ma vuota — nessuna posizione matcha il pattern attuale.");
  } else {
    const keys = Object.keys(matchState);
    console.log(`✅ ${keys.length} posizione/i in match:`);
    console.table(
      keys.map((rowKey) => ({
        rowKey,
        patternId: matchState[rowKey].patternId,
        matchStartAt: matchState[rowKey].matchStartAt?.slice(0, 16),
        patternIdMatch: pattern ? matchState[rowKey].patternId === pattern.id ? "✅" : "❌ diverso!" : "⚠️ no pattern",
      }))
    );
  }

  // ── 3. Portfolio aperto (ultimo tick) ───────────────────────────────────
  const rawSim = localStorage.getItem("invest_decision_sim_v1");
  const simState = rawSim ? JSON.parse(rawSim) : null;
  const ticks = simState?.ticks ?? [];
  const lastTick = ticks[ticks.length - 1] ?? null;
  const portfolio = lastTick?.portfolioAfter ?? simState?.paperPortfolio ?? [];

  console.log("\n═══ Portfolio aperto (ultimo tick) ══════════════════════════");
  if (portfolio.length === 0) {
    console.log("📭 Portfolio vuoto — updatePatternMatchState non produce output.");
  } else {
    const matchKeys = new Set(matchState ? Object.keys(matchState) : []);
    console.table(
      portfolio.map((pos) => ({
        key: pos.key,
        ticker: pos.ticker,
        entryAt: pos.entryAt?.slice(0, 16),
        inMatchState: matchKeys.has(pos.key) ? "✅ match" : "— no match",
        matchStart: matchState?.[pos.key]?.matchStartAt?.slice(0, 16) ?? null,
      }))
    );
  }

  // ── 4. Coerenza patternId ────────────────────────────────────────────────
  if (matchState && pattern) {
    const wrongId = Object.entries(matchState).filter(
      ([, v]) => v.patternId !== pattern.id
    );
    if (wrongId.length > 0) {
      console.warn("\n⚠️  Alcune voci hanno patternId diverso da quello approvato:");
      console.warn("   (non è un errore se il pattern è stato cambiato dopo l'ultimo tick)");
      console.table(wrongId.map(([k, v]) => ({ rowKey: k, savedId: v.patternId, currentId: pattern.id })));
    }
  }

  // ── 5. Timestamp ultimo tick vs matchStartAt ─────────────────────────────
  if (lastTick && matchState && Object.keys(matchState).length > 0) {
    console.log("\n═══ Timestamp sanity check ══════════════════════════════════");
    console.log(`   Ultimo tick at: ${lastTick.at?.slice(0, 19)}`);
    for (const [rowKey, rec] of Object.entries(matchState)) {
      const start = new Date(rec.matchStartAt);
      const tickTime = new Date(lastTick.at);
      const leadMs = tickTime - start;
      const leadH = (leadMs / 3600000).toFixed(1);
      const ok = leadMs >= 0;
      console.log(`   ${ok ? "✅" : "❌"} ${rowKey}: match iniziato ${rec.matchStartAt?.slice(0, 16)}, lead = ${ok ? leadH + "h" : "NEGATIVO — problema!"}`);
    }
  }

  console.log("\n═════════════════════════════════════════════════════════════");
  console.log("Script completato. Se invest_pattern_match_state_v1 è mancante,");
  console.log("esegui un tick manuale dall'UI e poi riesegui questo script.");
})();
