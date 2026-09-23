import { useCallback, useEffect, useState } from "react";
import { MANUAL_FEED_EVENTS_CHANGED_EVENT } from "../sheet/manualFeedEvents";
import { loadManualGainStarTickers } from "../sheet/manualFeedGainStar";

export function useManualGainStarTickers(): ReadonlySet<string> {
  const [tickers, setTickers] = useState<ReadonlySet<string>>(() => loadManualGainStarTickers());

  const refresh = useCallback(() => {
    setTickers(loadManualGainStarTickers());
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onChange);
  }, [refresh]);

  return tickers;
}
