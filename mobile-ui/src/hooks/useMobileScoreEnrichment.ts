import { useEffect, useState } from "react";
import {
  fetchMarketContextMcsSnapshot,
  fetchRegulatoryRiskSnapshot,
  fetchSdsByTicker,
  type RegulatoryRiskSnapshot,
} from "../api";
import type { MarketContextSnapshotDoc } from "../mobileMarketContext";

export type MobileScoreEnrichment = {
  sdsByTicker: Map<string, number>;
  regSnap: RegulatoryRiskSnapshot | null;
  mcsDoc: MarketContextSnapshotDoc | null;
  loading: boolean;
};

export function useMobileScoreEnrichment(): MobileScoreEnrichment {
  const [sdsByTicker, setSdsByTicker] = useState<Map<string, number>>(new Map());
  const [regSnap, setRegSnap] = useState<RegulatoryRiskSnapshot | null>(null);
  const [mcsDoc, setMcsDoc] = useState<MarketContextSnapshotDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      fetchSdsByTicker(),
      fetchRegulatoryRiskSnapshot().catch(() => null),
      fetchMarketContextMcsSnapshot().catch(() => null),
    ])
      .then(([sds, reg, mcs]) => {
        if (cancelled) return;
        setSdsByTicker(sds);
        setRegSnap(reg);
        setMcsDoc(mcs);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { sdsByTicker, regSnap, mcsDoc, loading };
}
