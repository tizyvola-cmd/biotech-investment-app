import { useEffect, useState } from "react";
import { fetchAiProviderInfo, type AiProviderInfo } from "../api/supernova";
import type { SheetTable } from "../types";
import { ClinicalPreCdFeedPanel } from "./ClinicalPreCdFeedPanel";
import { RefreshControls } from "./RefreshControls";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { useT } from "../shared/i18n";

export function CatalystFeedView({
  simTable,
  reloadSnapshotToken = 0,
  initialTickerFilter = null,
  onInitialTickerFilterConsumed,
  onReloadSnapshot,
}: {
  simTable?: SheetTable | null;
  reloadSnapshotToken?: number;
  initialTickerFilter?: string | null;
  onInitialTickerFilterConsumed?: () => void;
  onReloadSnapshot?: () => void;
}) {
  const t = useT();
  const [aiProvider, setAiProvider] = useState<AiProviderInfo | null>(null);

  useEffect(() => {
    void fetchAiProviderInfo()
      .then(setAiProvider)
      .catch(() => setAiProvider(null));
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 feed-panel-shell">
      <div className="flex justify-end px-3 py-2 shrink-0">
        <RefreshControls
          onLocalReload={() => onReloadSnapshot?.()}
          reloadTooltip={t("refresh.page.catalystFeed.tooltip")}
        />
      </div>
      <ViewErrorBoundary label="AI feed">
        <ClinicalPreCdFeedPanel
          simTable={simTable ?? null}
          aiProvider={aiProvider}
          onProviderUpdate={setAiProvider}
          reloadSnapshotToken={reloadSnapshotToken}
          initialTickerFilter={initialTickerFilter}
          onInitialTickerFilterConsumed={onInitialTickerFilterConsumed}
        />
      </ViewErrorBoundary>
    </div>
  );
}
