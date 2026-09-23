import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GAIN_STAR_LEDGER_CHANGED_EVENT,
  buildGainStarByTickerMap,
  type GainStarDisplay,
} from "../sheet/gainStarLedger";
import { MANUAL_FEED_EVENTS_CHANGED_EVENT } from "../sheet/manualFeedEvents";

export function useGainStarByTicker(): Map<string, GainStarDisplay[]> {
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, onChange);
    window.addEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, onChange);
      window.removeEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onChange);
    };
  }, [refresh]);

  return useMemo(() => buildGainStarByTickerMap(), [version]);
}

export function gainStarsForTicker(
  map: Map<string, GainStarDisplay[]>,
  ticker: string,
): GainStarDisplay[] {
  return map.get(ticker.trim().toUpperCase()) ?? [];
}
