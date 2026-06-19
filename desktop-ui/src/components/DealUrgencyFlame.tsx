import {
  dealUrgencyTooltip,
  type DealUrgencyVisual,
} from "../sheet/recommendationDealUrgency";
import { DEAL_URGENCY_ICON_SIZE, DealUrgencyColdFlameIcon } from "./DealUrgencyColdFlameIcon";

export function DealUrgencyFlame({
  visual,
  gainEur,
  days,
  lang,
}: {
  visual: DealUrgencyVisual;
  gainEur: number;
  days: number;
  lang: "it" | "en";
}) {
  if (visual.intensity <= 0 || !visual.temperature) return null;
  const tip = dealUrgencyTooltip(visual, gainEur, days, lang);

  if (visual.temperature === "cold") {
    return (
      <span className="deal-urgency-icon inline-flex shrink-0 items-center" title={tip} aria-hidden>
        <DealUrgencyColdFlameIcon size={DEAL_URGENCY_ICON_SIZE} />
      </span>
    );
  }

  return (
    <span
      className="deal-urgency-icon inline-flex shrink-0 items-center justify-center leading-none select-none"
      style={{ width: DEAL_URGENCY_ICON_SIZE, height: DEAL_URGENCY_ICON_SIZE, fontSize: DEAL_URGENCY_ICON_SIZE }}
      title={tip}
      aria-hidden
    >
      🔥
    </span>
  );
}
