import { useLang } from "../shared/i18n";
import {
  SignalScoreDetailPanel,
  type ScoreDetailSignal,
} from "./SignalScoreDetailPanel";
import type { SignAccuracyCurveView } from "../sheet/signAccuracyCurve";
import { AppModal, AppModalCloseButton } from "./AppModal";

export function ScoreAnalysisDrawer({
  open,
  onClose,
  signals,
  focusTicker,
  onFocusConsumed,
  signCurveView,
}: {
  open: boolean;
  onClose: () => void;
  signals: ScoreDetailSignal[];
  focusTicker?: string | null;
  onFocusConsumed?: () => void;
  signCurveView?: SignAccuracyCurveView | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  if (!open) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      align="end"
      aria-label={it ? "Analisi score" : "Score analysis"}
      panelClassName="flex h-full w-full max-w-4xl flex-col overflow-hidden border-l border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--accent))]/8 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {it ? "Analisi score" : "Score analysis"}
          </p>
          <p className="text-[11px] text-ink-muted">
            {it
              ? "Breakdown punteggio 0–100 per i ticker visibili nella tabella."
              : "0–100 score breakdown for tickers visible in the table."}
          </p>
        </div>
        <AppModalCloseButton onClose={onClose} className="flex h-7 w-7 items-center justify-center" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <SignalScoreDetailPanel
          signals={signals}
          focusTicker={focusTicker}
          onFocusConsumed={onFocusConsumed}
          signCurveView={signCurveView}
        />
      </div>
    </AppModal>
  );
}
