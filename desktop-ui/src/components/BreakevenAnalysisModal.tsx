import { useLang } from "../shared/i18n";

export function BreakevenAnalysisModal({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const it = lang === "it";

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
      <div className="w-full max-w-6xl bg-surface border border-[rgb(var(--border))] rounded-2xl shadow-2xl my-8">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-[rgb(var(--border))] bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
          <div>
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <span className="text-2xl">💰</span>
              {it ? "Break-Even & Diversificazione Portfolio" : "Break-Even & Portfolio Diversification"}
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {it ? "Analisi probabilità successo, allocazione capitale ed eterogeneità" : "Success probability, capital allocation and heterogeneity analysis"}
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
          
          {/* Dati Riferimento */}
          <section className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 border border-blue-200/50 dark:border-blue-800/50 rounded-lg">
            <h3 className="text-sm font-bold text-blue-900 dark:text-blue-100 mb-3">{it ? "📊 Dati di Riferimento" : "📊 Reference Data"}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="text-center p-2 bg-white/50 dark:bg-black/20 rounded">
                <div className="text-[10px] text-ink-muted">Win Rate</div>
                <div className="text-lg font-bold text-green-600">60.0%</div>
              </div>
              <div className="text-center p-2 bg-white/50 dark:bg-black/20 rounded">
                <div className="text-[10px] text-ink-muted">Avg Win</div>
                <div className="text-lg font-bold text-green-600">+159€</div>
              </div>
              <div className="text-center p-2 bg-white/50 dark:bg-black/20 rounded">
                <div className="text-[10px] text-ink-muted">Avg Loss</div>
                <div className="text-lg font-bold text-red-600">-177€</div>
              </div>
              <div className="text-center p-2 bg-white/50 dark:bg-black/20 rounded">
                <div className="text-[10px] text-ink-muted">Expectancy</div>
                <div className="text-lg font-bold text-blue-600">+24€</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-blue-200/50 dark:border-blue-800/50 text-xs text-blue-700/80 dark:text-blue-300/80">
              <strong>Break-Even WR:</strong> 52.7% · <strong>Sample:</strong> 15 trades · <strong>Avg Hold:</strong> 2 giorni
            </div>
          </section>

          {/* Section 1: Probabilità Successo */}
          <section>
            <h3 className="text-lg font-bold text-ink mb-3 flex items-center gap-2">
              <span>1.</span>
              {it ? "Probabilità di Successo: Portfolio vs Sim Loop" : "Success Probability: Portfolio vs Sim Loop"}
            </h3>
            
            <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-lg mb-4">
              <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100 mb-2">{it ? "Formula Break-Even" : "Break-Even Formula"}</h4>
              <div className="font-mono text-xs bg-white/50 dark:bg-black/20 px-3 py-2 rounded">
                BE_WR = AvgLoss / (AvgWin + AvgLoss) = 177 / 336 = <strong className="text-amber-600">52.7%</strong>
              </div>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-2">
                {it 
                  ? "Il tuo 60% è SUPERIORE al break-even → +7.3 punti percentuali di margine ✅"
                  : "Your 60% is ABOVE break-even → +7.3 percentage points margin ✅"}
              </p>
            </div>

            <div className="overflow-x-auto border border-[rgb(var(--border))] rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-surface/50 border-b border-[rgb(var(--border))]">
                  <tr>
                    <th className="text-center px-3 py-2 font-semibold text-ink">N Pos.</th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">{it ? "Win Necessari" : "Wins Needed"}</th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">P(Positivo)</th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">P&L {it ? "Atteso" : "Expected"}</th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">P&L/Giorno</th>
                    <th className="text-center px-3 py-2 font-semibold text-ink">{it ? "Capitale" : "Capital"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]/30">
                  <tr>
                    <td className="px-3 py-2 text-center">1</td>
                    <td className="px-3 py-2 text-center">1</td>
                    <td className="px-3 py-2 text-center">60.0%</td>
                    <td className="px-3 py-2 text-center">+24€</td>
                    <td className="px-3 py-2 text-center">+12€</td>
                    <td className="px-3 py-2 text-center">4,000€</td>
                  </tr>
                  <tr className="bg-green-50/30 dark:bg-green-900/10">
                    <td className="px-3 py-2 text-center font-bold">3</td>
                    <td className="px-3 py-2 text-center">2</td>
                    <td className="px-3 py-2 text-center font-bold text-green-600">64.8%</td>
                    <td className="px-3 py-2 text-center">+72€</td>
                    <td className="px-3 py-2 text-center">+36€</td>
                    <td className="px-3 py-2 text-center">12,000€</td>
                  </tr>
                  <tr className="bg-green-50/50 dark:bg-green-900/20">
                    <td className="px-3 py-2 text-center font-bold">5</td>
                    <td className="px-3 py-2 text-center">3</td>
                    <td className="px-3 py-2 text-center font-bold text-green-600">68.3%</td>
                    <td className="px-3 py-2 text-center">+120€</td>
                    <td className="px-3 py-2 text-center">+60€</td>
                    <td className="px-3 py-2 text-center">20,000€</td>
                  </tr>
                  <tr className="bg-emerald-50/50 dark:bg-emerald-900/20">
                    <td className="px-3 py-2 text-center font-bold text-emerald-600">7</td>
                    <td className="px-3 py-2 text-center">4</td>
                    <td className="px-3 py-2 text-center font-bold text-emerald-600">71.0%</td>
                    <td className="px-3 py-2 text-center font-bold">+168€</td>
                    <td className="px-3 py-2 text-center font-bold">+84€</td>
                    <td className="px-3 py-2 text-center">28,000€</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-center">10</td>
                    <td className="px-3 py-2 text-center">6</td>
                    <td className="px-3 py-2 text-center">63.3%</td>
                    <td className="px-3 py-2 text-center">+240€</td>
                    <td className="px-3 py-2 text-center">+120€</td>
                    <td className="px-3 py-2 text-center">40,000€</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-center">15</td>
                    <td className="px-3 py-2 text-center">9</td>
                    <td className="px-3 py-2 text-center font-bold text-blue-600">78.3%</td>
                    <td className="px-3 py-2 text-center">+360€</td>
                    <td className="px-3 py-2 text-center">+180€</td>
                    <td className="px-3 py-2 text-center">60,000€</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-center">20</td>
                    <td className="px-3 py-2 text-center">12</td>
                    <td className="px-3 py-2 text-center font-bold text-blue-600">82.8%</td>
                    <td className="px-3 py-2 text-center">+480€</td>
                    <td className="px-3 py-2 text-center">+240€</td>
                    <td className="px-3 py-2 text-center">80,000€</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/50 rounded-lg">
              <p className="text-xs text-emerald-800 dark:text-emerald-200 font-bold">
                🎯 {it ? "Sweet Spot: 5-7 posizioni → massima probabilità (68-71%) con capitale gestibile" : "Sweet Spot: 5-7 positions → maximum probability (68-71%) with manageable capital"}
              </p>
            </div>
          </section>

          {/* Section 2: Quanto Investire */}
          <section>
            <h3 className="text-lg font-bold text-ink mb-3 flex items-center gap-2">
              <span>2.</span>
              {it ? "Quanto Investire e su Quante Opportunità" : "How Much to Invest and on How Many Opportunities"}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Conservativo */}
              <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/50 rounded-lg">
                <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-1.5">
                  <span>🛡️</span>
                  <span>{it ? "Conservativo" : "Conservative"}</span>
                </h4>
                <div className="space-y-2 text-xs text-blue-800 dark:text-blue-200">
                  <div className="flex justify-between">
                    <span>{it ? "Posizioni" : "Positions"}:</span>
                    <span className="font-bold">5</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{it ? "Capitale" : "Capital"}:</span>
                    <span className="font-bold">20,000€</span>
                  </div>
                  <div className="flex justify-between">
                    <span>P(+):</span>
                    <span className="font-bold text-green-600">68.3%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>P&L/giorno:</span>
                    <span className="font-bold">+60€</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-blue-200/50 dark:border-blue-800/50 text-[11px] text-blue-700/80 dark:text-blue-300/80">
                  ✅ {it ? "Alta probabilità, capitale gestibile" : "High probability, manageable capital"}
                </div>
              </div>

              {/* Bilanciato */}
              <div className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border-2 border-emerald-300 dark:border-emerald-700 rounded-lg relative">
                <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full">
                  ⭐ {it ? "CONSIGLIATO" : "RECOMMENDED"}
                </div>
                <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-100 mb-2 flex items-center gap-1.5">
                  <span>⚖️</span>
                  <span>{it ? "Bilanciato" : "Balanced"}</span>
                </h4>
                <div className="space-y-2 text-xs text-emerald-800 dark:text-emerald-200">
                  <div className="flex justify-between">
                    <span>{it ? "Posizioni" : "Positions"}:</span>
                    <span className="font-bold">7-10</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{it ? "Capitale" : "Capital"}:</span>
                    <span className="font-bold">28k-40k€</span>
                  </div>
                  <div className="flex justify-between">
                    <span>P(+):</span>
                    <span className="font-bold text-green-600">63-71%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>P&L/giorno:</span>
                    <span className="font-bold">+84-120€</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-emerald-200/50 dark:border-emerald-800/50 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                  ✅ {it ? "Ottimo rischio/rendimento + diversificazione" : "Great risk/return + diversification"}
                </div>
              </div>

              {/* Aggressivo */}
              <div className="p-4 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/50 rounded-lg">
                <h4 className="text-sm font-bold text-purple-900 dark:text-purple-100 mb-2 flex items-center gap-1.5">
                  <span>🚀</span>
                  <span>{it ? "Aggressivo" : "Aggressive"}</span>
                </h4>
                <div className="space-y-2 text-xs text-purple-800 dark:text-purple-200">
                  <div className="flex justify-between">
                    <span>{it ? "Posizioni" : "Positions"}:</span>
                    <span className="font-bold">15+</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{it ? "Capitale" : "Capital"}:</span>
                    <span className="font-bold">60,000€+</span>
                  </div>
                  <div className="flex justify-between">
                    <span>P(+):</span>
                    <span className="font-bold text-green-600">78%+</span>
                  </div>
                  <div className="flex justify-between">
                    <span>P&L/giorno:</span>
                    <span className="font-bold">+180€+</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-purple-200/50 dark:border-purple-800/50 text-[11px] text-purple-700/80 dark:text-purple-300/80">
                  ⚠️ {it ? "Richiede capitale elevato e gestione attiva" : "Requires high capital and active management"}
                </div>
              </div>
            </div>

            {/* Kelly Criterion */}
            <div className="mt-4 p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-lg">
              <h4 className="text-sm font-bold text-amber-900 dark:text-amber-100 mb-2">{it ? "📐 Kelly Criterion Semplificato" : "📐 Simplified Kelly Criterion"}</h4>
              <div className="font-mono text-xs bg-white/50 dark:bg-black/20 px-3 py-2 rounded mb-2">
                (0.60 - 0.527) / (159 / 177) = 0.073 / 0.898 = <strong className="text-amber-600">8.1%</strong> per trade
              </div>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                <strong>{it ? "Raccomandazione" : "Recommendation"}:</strong> {it ? "Investi 6-10% del capitale per posizione (Kelly × 0.75 per sicurezza)" : "Invest 6-10% of capital per position (Kelly × 0.75 for safety)"}
              </p>
            </div>
          </section>

          {/* Section 3: Eterogeneità */}
          <section>
            <h3 className="text-lg font-bold text-ink mb-3 flex items-center gap-2">
              <span>3.</span>
              {it ? "Analisi Eterogeneità Portfolio" : "Portfolio Heterogeneity Analysis"}
            </h3>

            {/* Fase Clinica */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-ink mb-2">{it ? "Diversificazione per Fase Clinica" : "Diversification by Clinical Phase"}</h4>
              <div className="overflow-x-auto border border-[rgb(var(--border))] rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-surface/50 border-b border-[rgb(var(--border))]">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-ink">{it ? "Fase Clinica" : "Clinical Phase"}</th>
                      <th className="text-center px-3 py-2 font-semibold text-ink">% Portfolio</th>
                      <th className="text-left px-3 py-2 font-semibold text-ink">{it ? "Caratteristiche" : "Characteristics"}</th>
                      <th className="text-center px-3 py-2 font-semibold text-ink">SDS Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border))]/30">
                    <tr className="bg-red-50/30 dark:bg-red-900/10">
                      <td className="px-3 py-2">Pre-clinical</td>
                      <td className="px-3 py-2 text-center">10-15%</td>
                      <td className="px-3 py-2 text-ink-muted">{it ? "Alto rischio / Alto reward" : "High risk / High reward"}</td>
                      <td className="px-3 py-2 text-center font-mono">&lt; 50</td>
                    </tr>
                    <tr className="bg-orange-50/30 dark:bg-orange-900/10">
                      <td className="px-3 py-2">Phase 1</td>
                      <td className="px-3 py-2 text-center">15-20%</td>
                      <td className="px-3 py-2 text-ink-muted">{it ? "Risk elevato / Reward alto" : "High risk / High reward"}</td>
                      <td className="px-3 py-2 text-center font-mono">50-60</td>
                    </tr>
                    <tr className="bg-amber-50/30 dark:bg-amber-900/10">
                      <td className="px-3 py-2 font-semibold">Phase 2</td>
                      <td className="px-3 py-2 text-center font-semibold">25-35%</td>
                      <td className="px-3 py-2 text-ink-muted font-semibold">{it ? "Bilanciato" : "Balanced"}</td>
                      <td className="px-3 py-2 text-center font-mono font-semibold">60-75</td>
                    </tr>
                    <tr className="bg-green-50/30 dark:bg-green-900/10">
                      <td className="px-3 py-2 font-semibold">Phase 3</td>
                      <td className="px-3 py-2 text-center font-semibold">30-40%</td>
                      <td className="px-3 py-2 text-ink-muted">{it ? "Risk moderato / Reward moderato" : "Moderate risk / Moderate reward"}</td>
                      <td className="px-3 py-2 text-center font-mono font-semibold">75-85</td>
                    </tr>
                    <tr className="bg-blue-50/30 dark:bg-blue-900/10">
                      <td className="px-3 py-2">Pre-approval (PDUFA)</td>
                      <td className="px-3 py-2 text-center">10-20%</td>
                      <td className="px-3 py-2 text-ink-muted">{it ? "Risk basso / Reward concentrato" : "Low risk / Concentrated reward"}</td>
                      <td className="px-3 py-2 text-center font-mono">85-95</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Barbell Strategy */}
            <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border border-purple-200/50 dark:border-purple-800/50 rounded-lg">
              <h4 className="text-sm font-bold text-purple-900 dark:text-purple-100 mb-3 flex items-center gap-2">
                <span>📊</span>
                <span>{it ? "Strategia 'Bilanciere' (Barbell Strategy)" : "Barbell Strategy"}</span>
              </h4>
              
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-white/50 dark:bg-black/20 rounded">
                  <div className="font-bold text-red-600 mb-1">{it ? "ASSE SINISTRO (Rischio Alto, 20%)" : "LEFT AXIS (High Risk, 20%)"}</div>
                  <div className="text-ink-muted">2× deals SDS &lt;60, RA &gt;70 → 8,000€</div>
                  <div className="text-[11px] text-green-600 mt-1">Target: +35% gain (+2,800€)</div>
                </div>

                <div className="p-3 bg-white/50 dark:bg-black/20 rounded border-2 border-emerald-300 dark:border-emerald-700">
                  <div className="font-bold text-emerald-600 mb-1">{it ? "CORE CENTRALE (Rischio Medio-Basso, 60%)" : "CENTRAL CORE (Medium-Low Risk, 60%)"}</div>
                  <div className="text-ink-muted">4× deals SDS 70-80 + 2× deals SDS 80-85 → 24,000€</div>
                  <div className="text-[11px] text-green-600 mt-1">Target: +20% gain medio (+4,800€)</div>
                </div>

                <div className="p-3 bg-white/50 dark:bg-black/20 rounded">
                  <div className="font-bold text-blue-600 mb-1">{it ? "ASSE DESTRO (Rischio Minimo, 20%)" : "RIGHT AXIS (Minimum Risk, 20%)"}</div>
                  <div className="text-ink-muted">2× deals SDS &gt;85, RA &gt;85 → 8,000€</div>
                  <div className="text-[11px] text-green-600 mt-1">Target: +12% gain (+960€)</div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-purple-200/50 dark:border-purple-800/50 text-xs">
                <div className="font-bold text-purple-700 dark:text-purple-300">{it ? "Mix Ottimale: 20/60/20" : "Optimal Mix: 20/60/20"}</div>
                <div className="text-purple-600 dark:text-purple-400 mt-1">Expectancy media: +240€ (10 deals × 24€)</div>
              </div>
            </div>
          </section>

          {/* Conclusioni */}
          <section className="p-4 bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/20 dark:to-blue-950/20 border border-indigo-200/50 dark:border-indigo-800/50 rounded-lg">
            <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 mb-3 flex items-center gap-2">
              <span>💎</span>
              <span>{it ? "Raccomandazioni Finali" : "Final Recommendations"}</span>
            </h3>
            <ul className="space-y-2 text-xs text-indigo-800 dark:text-indigo-200">
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold">1.</span>
                <span><strong>{it ? "TARGET POSIZIONI" : "TARGET POSITIONS"}:</strong> 7-10 deals {it ? "per massimizzare" : "to maximize"} P(Positivo) (68-71%)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold">2.</span>
                <span><strong>{it ? "CAPITALE PER DEAL" : "CAPITAL PER DEAL"}:</strong> €4,000 (6-10% {it ? "del capitale totale" : "of total capital"})</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold">3.</span>
                <span><strong>{it ? "CAPITALE TOTALE MINIMO" : "MINIMUM TOTAL CAPITAL"}:</strong> €30,000-40,000 {it ? "per strategia efficace" : "for effective strategy"}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold">4.</span>
                <span><strong>{it ? "MIX RISCHIO" : "RISK MIX"}:</strong> 20% {it ? "alto" : "high"} / 60% {it ? "medio" : "medium"} / 20% {it ? "basso" : "low"} (Barbell Strategy)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold">5.</span>
                <span><strong>P&L {it ? "GIORNALIERO ATTESO" : "EXPECTED DAILY"}:</strong> +84€ a +120€ ({it ? "con" : "with"} 7-10 {it ? "posizioni" : "positions"})</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-600 font-bold">6.</span>
                <span><strong>P&L {it ? "MENSILE ATTESO" : "EXPECTED MONTHLY"}:</strong> +2,500€ a +3,600€ (20-30 {it ? "giorni operativi" : "trading days"})</span>
              </li>
            </ul>
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 px-6 py-3 border-t border-[rgb(var(--border))] bg-surface/80 backdrop-blur-sm flex items-center justify-between text-[10px] text-ink-muted">
          <span>{it ? "Documento generato: 17 giugno 2026" : "Document generated: June 17, 2026"}</span>
          <span>{it ? "Basato su: 15 trades chiusi, Win Rate 60%, Expectancy +24€" : "Based on: 15 closed trades, Win Rate 60%, Expectancy +24€"}</span>
        </div>
      </div>
    </div>
  );
}
