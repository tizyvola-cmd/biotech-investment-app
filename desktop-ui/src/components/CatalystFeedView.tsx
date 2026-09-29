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
    <div className="flex flex-col w-full feed-panel-shell">
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-[rgb(var(--border))]/60">
        <span className="text-[11px] font-semibold text-ink">
          📰 {t("sidebar.item.catalystFeed")}
        </span>
        <div className="ml-auto">
          <RefreshControls
            onLocalReload={() => onReloadSnapshot?.()}
            reloadTooltip={t("refresh.page.catalystFeed.tooltip")}
          />
        </div>
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
