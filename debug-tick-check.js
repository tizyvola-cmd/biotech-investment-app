// Incolla nella DevTools Console con l'app aperta (F12 → Console)
(() => {
  const raw = localStorage.getItem("invest_decision_sim_v1");
  if (!raw) { console.warn("Nessun dato trovato in invest_decision_sim_v1"); return; }

  const state = JSON.parse(raw);
  const ticks = state.ticks ?? [];

  const results = ticks.map((t, i) => {
    const piggy = t.summary?.piggyBank;
    const openPos = (t.portfolioAfter ?? []).length;
    const openMtm = piggy?.openMtmPnlEur ?? null;
    const closedPnl = piggy?.closedPnlEur ?? null;
    const totalPnl = piggy?.totalPnlEur ?? null;
    const evals = (t.evaluations ?? []).length;
    const hasMarks = (t.portfolioAfter ?? []).some(p => p.lastMarkPct != null);

    return {
      i,
      at: t.at?.slice(0, 16),
      openPos,
      evals,
      hasMarks,
      openMtm,
      closedPnl,
      totalPnl,
      piggyMissing: !piggy,
      zeroProblem: openPos > 0 && (openMtm == null || openMtm === 0),
    };
  });

  const withOpenPos = results.filter(r => r.openPos > 0);
  const zeroMtm    = withOpenPos.filter(r => r.zeroProblem);
  const okMtm      = withOpenPos.filter(r => !r.zeroProblem);

  console.log(`Totale tick: ${ticks.length}`);
  console.log(`Tick con posizioni aperte: ${withOpenPos.length}`);
  console.log(`  ✅ openMtmPnlEur popolato: ${okMtm.length}`);
  console.log(`  ❌ openMtmPnlEur zero/null (problema): ${zeroMtm.length}`);

  if (zeroMtm.length > 0) {
    console.log("\n--- Tick problematici ---");
    console.table(zeroMtm.map(r => ({
      "#": r.i,
      at: r.at,
      openPos: r.openPos,
      evals: r.evals,
      hasMarks: r.hasMarks,
      openMtm: r.openMtm,
      closedPnl: r.closedPnl,
      totalPnl: r.totalPnl,
    })));
  }

  if (okMtm.length > 0) {
    console.log("\n--- Tick OK (campione ultimi 5) ---");
    console.table(okMtm.slice(-5).map(r => ({
      "#": r.i,
      at: r.at,
      openPos: r.openPos,
      openMtm: r.openMtm,
      closedPnl: r.closedPnl,
      totalPnl: r.totalPnl,
    })));
  }

  // Riepilogo piggyBank sull'ultimo tick
  const last = ticks[ticks.length - 1];
  if (last?.summary?.piggyBank) {
    console.log("\n--- piggyBank ultimo tick ---");
    console.log(last.summary.piggyBank);
  }
})();
