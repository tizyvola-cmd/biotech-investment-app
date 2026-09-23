import type { ChartBundle, SheetTable } from "../types";
import { useLang } from "../shared/i18n";
import { RecommendationCompositionPanel } from "./RecommendationCompositionPanel";

/**
 * Prediction & recommendation engine guide — Soft BUY / Soft·Urgent·continuation SELL.
 * Paper sim-loop maturation exits removed with the sim-loop UI.
 */
export function TesterPredictionTab({
  apiOk: _apiOk,
  simTable = null,
  chartsBundle: _chartsBundle = null,
}: {
  apiOk: boolean | null;
  simTable?: SheetTable | null;
  chartsBundle?: ChartBundle | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  void _apiOk;
  void _chartsBundle;

  if (!simTable?.rows?.length) {
    return (
      <div className="tester-monitor-panel rounded-xl p-6 text-center">
        <p className="text-sm text-ink-muted">
          {it
            ? "Carica la tabella Simulation per vedere la guida raccomandazioni."
            : "Load the Simulation sheet to view the recommendation guide."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="tester-monitor-panel rounded-2xl px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-ink">
          {it ? "Meccanismo predizioni & raccomandazioni" : "Prediction & recommendation engine"}
        </p>
        <p className="text-[11px] text-ink-muted leading-relaxed max-w-[960px]">
          {it
            ? "Fonte UI: suggestedAction (deriveSuggestedAction). BUY = Soft BUY G1/G1c. SELL = Urgent G2 (auto) · Soft G1 · take-profit continuation (10d %≥5% + edge>0) · hard. Mai SELL su MTM>0 salvo continuation. HOLD/review quando conviene attendere o il profilo non è chiaro."
            : "UI source: suggestedAction (deriveSuggestedAction). BUY = Soft BUY G1/G1c. SELL = Urgent G2 (auto) · Soft G1 · continuation take-profit (10d %≥5% + edge>0) · hard. Never SELL on MTM>0 except continuation. HOLD/review when waiting or the profile is unclear."}
        </p>
      </div>

      <RecommendationCompositionPanel lang={lang} />
    </div>
  );
}
