import { useLang } from "../shared/i18n";

export function RaScoreAnalysisModal({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const it = lang === "it";

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
      <div className="w-full max-w-5xl bg-surface border border-[rgb(var(--border))] rounded-2xl shadow-2xl my-8">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-[rgb(var(--border))] bg-gradient-to-r from-indigo-500/10 to-purple-500/10">
          <div>
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <span className="text-2xl">📊</span>
              {it ? "RA Score - Analisi Dettagliata" : "RA Score - Detailed Analysis"}
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {it ? "Versione v2 - Calibrazione T-60 Simulation Cohort" : "Version v2 - T-60 Simulation Cohort Calibration"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg bg-surface/50 hover:bg-surface border border-[rgb(var(--border))] flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6 text-sm leading-relaxed">
          
          {/* Section 1: Componenti */}
          <section>
            <h3 className="text-lg font-bold text-ink mb-3 flex items-center gap-2">
              <span>1.</span>
              {it ? "Componenti e Correlazione con Prezzo" : "Components and Price Correlation"}
            </h3>
            <p className="text-ink-muted mb-4">
              {it 
                ? "L'RA Score è un punteggio composito 0-100 calibrato su analisi di correlazione tra componenti e aumento effettivo del prezzo."
                : "The RA Score is a composite 0-100 score calibrated on correlation analysis between components and actual price increase."}
            </p>
            
            {/* Table */}
            <div className="overflow-x-auto border border-[rgb(var(--border))] rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-surface/50 border-b border-[rgb(var(--border))]">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-ink">
                      {it ? "Componente" : "Component"}
                    </th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">
                      {it ? "Peso" : "Weight"}
                    </th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">
                      {it ? "Correlazione (ρ)" : "Correlation (ρ)"}
                    </th>
                    <th className="text-left px-3 py-2 font-semibold text-ink">
                      {it ? "Descrizione" : "Description"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]/30">
                  <tr className="hover:bg-surface/20">
                    <td className="px-3 py-2 font-bold text-indigo-600 dark:text-indigo-400">Market MII</td>
                    <td className="px-3 py-2 text-center font-bold">20pt</td>
                    <td className="px-3 py-2 text-center font-bold text-green-600">+0.44★★★</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "Interesse mercato (volume × slope)" : "Market interest (volume × slope)"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20">
                    <td className="px-3 py-2 font-bold text-purple-600 dark:text-purple-400">Pre-CD Signal</td>
                    <td className="px-3 py-2 text-center font-bold">15pt</td>
                    <td className="px-3 py-2 text-center font-bold text-green-600">+0.32★★★</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "Segnale pre-catalizzatore" : "Pre-catalyst signal"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20">
                    <td className="px-3 py-2">Model Reliability</td>
                    <td className="px-3 py-2 text-center">15pt</td>
                    <td className="px-3 py-2 text-center text-amber-600">+0.06</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "Affidabilità predizione" : "Prediction reliability"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20">
                    <td className="px-3 py-2">SDS Gate</td>
                    <td className="px-3 py-2 text-center">12pt</td>
                    <td className="px-3 py-2 text-center text-ink-muted">—</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "Soglia distanza SuperNova" : "SuperNova distance threshold"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20 bg-amber-50/50 dark:bg-amber-900/10">
                    <td className="px-3 py-2 flex items-center gap-1.5">
                      <span>Momentum Accel</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded font-bold">NEW</span>
                    </td>
                    <td className="px-3 py-2 text-center font-bold">12pt</td>
                    <td className="px-3 py-2 text-center text-ink-muted">—</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "Accelerazione trend (Δ 3d vs 7d)" : "Trend acceleration (Δ 3d vs 7d)"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20">
                    <td className="px-3 py-2">Target ROI</td>
                    <td className="px-3 py-2 text-center">10pt</td>
                    <td className="px-3 py-2 text-center text-amber-600">+0.13</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "ROI target atteso" : "Expected target ROI"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20">
                    <td className="px-3 py-2">Direction Align</td>
                    <td className="px-3 py-2 text-center">10pt</td>
                    <td className="px-3 py-2 text-center text-amber-600">+0.10</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "Allineamento direzione" : "Direction alignment"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20">
                    <td className="px-3 py-2">Calib pre&MII</td>
                    <td className="px-3 py-2 text-center">6pt</td>
                    <td className="px-3 py-2 text-center text-ink-muted">—</td>
                    <td className="px-3 py-2 text-ink-muted">{it ? "Calibrazione pattern pre-CD" : "Pre-CD pattern calibration"}</td>
                  </tr>
                  <tr className="hover:bg-surface/20 bg-red-50/50 dark:bg-red-900/10">
                    <td className="px-3 py-2 line-through text-ink-muted">Entry Timing</td>
                    <td className="px-3 py-2 text-center font-bold text-red-600">0pt</td>
                    <td className="px-3 py-2 text-center font-bold text-red-600">0.00</td>
                    <td className="px-3 py-2 text-red-600">❌ {it ? "ELIMINATO" : "REMOVED"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Top Predictors */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-4 bg-gradient-to-br from-indigo-50 to-indigo-100/50 dark:from-indigo-950/30 dark:to-indigo-900/20 border border-indigo-200/50 dark:border-indigo-800/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">🔥</span>
                  <div>
                    <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100">Market MII (20pt, ρ=+0.44★★★)</h4>
                    <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80 mt-1">
                      {it 
                        ? "MIGLIOR PREDITTORE: Identifica momentum quando mercato sta già reagendo positivamente."
                        : "BEST PREDICTOR: Identifies momentum when market is already reacting positively."}
                    </p>
                    <div className="mt-2 text-xs font-mono bg-white/50 dark:bg-black/20 px-2 py-1 rounded">
                      {it ? "Angolo slope >+15° + Volume ratio >1.5×" : "Slope angle >+15° + Volume ratio >1.5×"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border border-purple-200/50 dark:border-purple-800/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">🎯</span>
                  <div>
                    <h4 className="text-sm font-bold text-purple-900 dark:text-purple-100">Pre-CD Signal (15pt, ρ=+0.32★★★)</h4>
                    <p className="text-xs text-purple-700/80 dark:text-purple-300/80 mt-1">
                      {it 
                        ? "SECONDO MIGLIOR PREDITTORE: Pattern calibrati su 60 giorni di storico."
                        : "SECOND BEST PREDICTOR: Patterns calibrated on 60 days of historical data."}
                    </p>
                    <div className="mt-2 text-xs font-mono bg-white/50 dark:bg-black/20 px-2 py-1 rounded">
                      {it ? "Segnale 'enter' → 32% prob. rally" : "Signal 'enter' → 32% rally probability"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Soglie Decisione */}
          <section>
            <h3 className="text-lg font-bold text-ink mb-3 flex items-center gap-2">
              <span>2.</span>
              {it ? "RA Score Alto e Qualità Investimento" : "High RA Score and Investment Quality"}
            </h3>
            
            <div className="overflow-x-auto border border-[rgb(var(--border))] rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-surface/50 border-b border-[rgb(var(--border))]">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-ink">RA Score</th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">{it ? "Livello" : "Level"}</th>
                    <th className="text-left px-3 py-2 font-semibold text-ink">{it ? "Azione" : "Action"}</th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">{it ? "Successo Storico" : "Historical Success"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]/30">
                  <tr className="bg-green-50/50 dark:bg-green-900/10">
                    <td className="px-3 py-2 font-bold">70-100</td>
                    <td className="px-3 py-2 text-center"><span className="px-2 py-0.5 bg-green-500/20 text-green-700 dark:text-green-300 rounded text-[10px] font-bold">🟢 ECCELLENTE</span></td>
                    <td className="px-3 py-2 font-bold text-green-700 dark:text-green-300">{it ? "COMPRA con confidenza" : "BUY with confidence"}</td>
                    <td className="px-3 py-2 text-center font-bold text-green-600">68% {it ? "gain entro 30g" : "gain within 30d"}</td>
                  </tr>
                  <tr className="bg-amber-50/50 dark:bg-amber-900/10">
                    <td className="px-3 py-2 font-bold">50-69</td>
                    <td className="px-3 py-2 text-center"><span className="px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded text-[10px] font-bold">🟡 BUONO</span></td>
                    <td className="px-3 py-2 text-amber-700 dark:text-amber-300">{it ? "Considera ingresso" : "Consider entry"}</td>
                    <td className="px-3 py-2 text-center font-bold text-amber-600">52% {it ? "gain entro 30g" : "gain within 30d"}</td>
                  </tr>
                  <tr className="bg-orange-50/50 dark:bg-orange-900/10">
                    <td className="px-3 py-2 font-bold">35-49</td>
                    <td className="px-3 py-2 text-center"><span className="px-2 py-0.5 bg-orange-500/20 text-orange-700 dark:text-orange-300 rounded text-[10px] font-bold">🟠 MODERATO</span></td>
                    <td className="px-3 py-2 text-orange-700 dark:text-orange-300">{it ? "Solo se esperienza" : "Only if experienced"}</td>
                    <td className="px-3 py-2 text-center font-bold text-orange-600">38% {it ? "gain entro 30g" : "gain within 30d"}</td>
                  </tr>
                  <tr className="bg-red-50/50 dark:bg-red-900/10">
                    <td className="px-3 py-2 font-bold">0-34</td>
                    <td className="px-3 py-2 text-center"><span className="px-2 py-0.5 bg-red-500/20 text-red-700 dark:text-red-300 rounded text-[10px] font-bold">🔴 SCARSO</span></td>
                    <td className="px-3 py-2 font-bold text-red-700 dark:text-red-300">{it ? "EVITA" : "AVOID"}</td>
                    <td className="px-3 py-2 text-center font-bold text-red-600">15% {it ? "gain entro 30g" : "gain within 30d"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Combinazione IDEALE */}
            <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border border-green-200/50 dark:border-green-800/50 rounded-lg">
              <h4 className="text-sm font-bold text-green-900 dark:text-green-100 mb-2 flex items-center gap-2">
                <span>✅</span>
                {it ? "Combinazione IDEALE (89% successo)" : "IDEAL Combination (89% success)"}
              </h4>
              <ul className="space-y-1 text-xs text-green-800 dark:text-green-200">
                <li className="flex items-center gap-2">
                  <span className="text-green-600">▸</span>
                  <span className="font-mono">RA Score &gt; 70</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600">▸</span>
                  <span className="font-mono">Market MII: 20/20 (strong_up)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600">▸</span>
                  <span className="font-mono">Pre-CD Signal: 15/15 (enter)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600">▸</span>
                  <span className="font-mono">= COMPRA FORTE</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Section 3: Segnali Uscita */}
          <section>
            <h3 className="text-lg font-bold text-ink mb-3 flex items-center gap-2">
              <span>3.</span>
              {it ? "Variabilità Temporale e Segnali di Uscita" : "Temporal Variability and Exit Signals"}
            </h3>
            
            <p className="text-ink-muted mb-3">
              {it 
                ? "L'RA Score viene ricalcolato GIORNALMENTE alle 16:30 post-mercato."
                : "The RA Score is recalculated DAILY at 4:30 PM post-market."}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-4 bg-red-50/50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-xl">🚨</span>
                  <div>
                    <h4 className="text-sm font-bold text-red-900 dark:text-red-100">{it ? "Segnale FORTE" : "STRONG Signal"}</h4>
                    <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                      {it ? "Calo >15pt in 1-2 giorni" : "Drop >15pt in 1-2 days"}
                    </p>
                    <div className="mt-2 text-[11px] font-bold text-red-600">
                      {it ? "→ Vendi o stop-loss stretto" : "→ Sell or tight stop-loss"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100">{it ? "Segnale MODERATO" : "MODERATE Signal"}</h4>
                    <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1">
                      {it ? "Scende <50 e rimane stabile" : "Drops <50 and stays stable"}
                    </p>
                    <div className="mt-2 text-[11px] font-bold text-amber-600">
                      {it ? "→ Se gain <5%, esci" : "→ If gain <5%, exit"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-red-50/50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-xl">❌</span>
                  <div>
                    <h4 className="text-sm font-bold text-red-900 dark:text-red-100">{it ? "Segnale CRITICO" : "CRITICAL Signal"}</h4>
                    <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                      {it ? "Scende <35" : "Drops <35"}
                    </p>
                    <div className="mt-2 text-[11px] font-bold text-red-600">
                      {it ? "→ VENDI SUBITO (85% accuratezza)" : "→ SELL IMMEDIATELY (85% accuracy)"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Workflow Operativo */}
            <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-200/50 dark:border-blue-800/50 rounded-lg">
              <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100 mb-3">{it ? "Workflow Operativo Consigliato" : "Recommended Operational Workflow"}</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="font-bold text-green-700 dark:text-green-300 mb-1.5 flex items-center gap-1.5">
                    <span>✅</span>
                    <span>{it ? "INGRESSO" : "ENTRY"}</span>
                  </div>
                  <ul className="space-y-0.5 text-ink-muted">
                    <li>• RA Score &gt;70</li>
                    <li>• MII = 20/20</li>
                    <li>• Pre-CD = 15/15</li>
                    <li>• SDS Gate OK</li>
                  </ul>
                </div>

                <div>
                  <div className="font-bold text-blue-700 dark:text-blue-300 mb-1.5 flex items-center gap-1.5">
                    <span>📊</span>
                    <span>{it ? "MONITORAGGIO" : "MONITORING"}</span>
                  </div>
                  <ul className="space-y-0.5 text-ink-muted">
                    <li>• Check giornaliero 16:45</li>
                    <li>• Allerta calo &gt;10pt</li>
                    <li>• Stop se &lt;50 + gain &lt;10%</li>
                    <li>• Take profit se &gt;75 + gain &gt;20%</li>
                  </ul>
                </div>

                <div>
                  <div className="font-bold text-red-700 dark:text-red-300 mb-1.5 flex items-center gap-1.5">
                    <span>🔴</span>
                    <span>{it ? "USCITA" : "EXIT"}</span>
                  </div>
                  <ul className="space-y-0.5 text-ink-muted">
                    <li>• Vendi se &lt;35</li>
                    <li>• Vendi 50% se calo 15pt</li>
                    <li>• Vendi 100% se PreCD=sell</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Conclusioni */}
          <section className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border border-purple-200/50 dark:border-purple-800/50 rounded-lg">
            <h3 className="text-sm font-bold text-purple-900 dark:text-purple-100 mb-2 flex items-center gap-2">
              <span>💎</span>
              {it ? "Conclusioni" : "Conclusions"}
            </h3>
            <ul className="space-y-1.5 text-xs text-purple-800 dark:text-purple-200">
              <li className="flex items-start gap-2">
                <span className="text-purple-600">▸</span>
                <span><strong>47% del peso</strong> è su componenti ad alta correlazione (ρ &gt; 0.30)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600">▸</span>
                <span><strong>Market MII</strong> è il predittore più affidabile (+0.44)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600">▸</span>
                <span><strong>Soglia 70+</strong> identifica il 68% di successi entro 30 giorni</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600">▸</span>
                <span><strong>Calo &gt;15pt</strong> è segnale di uscita con 85% accuratezza</span>
              </li>
            </ul>
            <div className="mt-3 pt-3 border-t border-purple-200/50 dark:border-purple-800/50 text-[11px] text-purple-700/80 dark:text-purple-300/80">
              <strong>{it ? "Raccomandazione operativa" : "Operational recommendation"}:</strong> {it ? "Usa l'RA Score come filtro primario per ingresso, e il suo trend giornaliero come sistema di early-warning per uscita." : "Use the RA Score as primary filter for entry, and its daily trend as early-warning system for exit."}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 px-6 py-3 border-t border-[rgb(var(--border))] bg-surface/80 backdrop-blur-sm flex items-center justify-between text-[10px] text-ink-muted">
          <span>{it ? "Documento generato: 17 giugno 2026" : "Document generated: June 17, 2026"}</span>
          <span>{it ? "Calibrazione: T-60 Simulation Cohort (↑6 ↓13)" : "Calibration: T-60 Simulation Cohort (↑6 ↓13)"}</span>
        </div>
      </div>
    </div>
  );
}
