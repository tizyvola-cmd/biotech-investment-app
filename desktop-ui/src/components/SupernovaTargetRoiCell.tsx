import { useLang } from "../shared/i18n";
import { TargetRoiCell } from "../sheet/expectedRoiDisplay";
import { formatEstRoiSigned } from "../sheet/sdsCompareOverlay";
import { supernovaOffsetLabel } from "../sheet/sdsHistoryCurve";
import type { SupernovaTargetRoi } from "../sheet/supernovaTargetRoi";

export function SupernovaTargetRoiCell({
  roi,
  capitalEur,
  slope5d,
  slope20d,
  currentPriceUsd,
}: {
  roi: SupernovaTargetRoi | null;
  capitalEur?: number;
  slope5d?: number | null;
  slope20d?: number | null;
  currentPriceUsd?: number | null;
}) {
  const { lang } = useLang();
  if (!roi) {
    return <span className="text-ink-muted text-[10px]">—</span>;
  }

  const tip =
    lang === "it"
      ? `ROI-Target SuperNova: fine tratto di crescita stimato sulla curva pred+recalib (${formatEstRoiSigned(roi.returnPct)} al picco ${supernovaOffsetLabel(roi.peakOffset)} vs CD)${
          roi.daysToTarget != null ? ` · ~${roi.daysToTarget}g da oggi` : ""
        }. Non è il P&L di portafoglio.`
      : `SuperNova target ROI: end of estimated rise on pred+recalib curve (${formatEstRoiSigned(roi.returnPct)} at peak ${supernovaOffsetLabel(roi.peakOffset)} vs CD)${
          roi.daysToTarget != null ? ` · ~${roi.daysToTarget}d from today` : ""
        }. Not portfolio P&L.`;

  return (
    <div title={tip}>
      <TargetRoiCell
        lang={lang === "it" ? "it" : "en"}
        daysToTarget={roi.daysToTarget}
        returnPct={roi.returnPct}
        capitalEur={capitalEur}
        variant="table"
        slope5d={slope5d}
        slope20d={slope20d}
        currentPriceUsd={currentPriceUsd}
      />
    </div>
  );
}
