import { useMemo } from "react";
import type { ClinicalPreCdRecord } from "../api";
import { buildTickerEisDetail } from "../eis/tickerEisSummary";
import { manualEisForTicker } from "../gainStarDisplay";
import type { MobileManualEisRow } from "../manualFeedStore";
import { useMobileLang } from "../hooks/useMobileLang";
import { MobileTickerImpactPanel } from "./MobileTickerImpactPanel";

type Props = {
  ticker: string;
  eisScore: number | null;
  manualEisByTicker?: Record<string, MobileManualEisRow> | null;
  regSignedScore: number | null;
  clinicalRecords: ClinicalPreCdRecord[];
  onOpenEis: () => void;
  onOpenRegulatory: () => void;
};

export function MobileEisRegulatoryPanel({
  ticker,
  eisScore,
  manualEisByTicker,
  regSignedScore,
  clinicalRecords,
  onOpenEis,
  onOpenRegulatory,
}: Props) {
  const { lang } = useMobileLang();
  const manualEis = manualEisForTicker(manualEisByTicker, ticker);
  const sheetFallback = manualEis?.score ?? eisScore ?? undefined;
  const eisDetail = useMemo(
    () => buildTickerEisDetail(ticker, clinicalRecords, lang, sheetFallback ?? undefined),
    [ticker, clinicalRecords, lang, sheetFallback],
  );
  return (
    <MobileTickerImpactPanel
      eisDetail={eisDetail}
      regulatorySignedScore={regSignedScore}
      onOpenEis={onOpenEis}
      onOpenRegulatory={onOpenRegulatory}
      onOpenAll={onOpenEis}
    />
  );
}
