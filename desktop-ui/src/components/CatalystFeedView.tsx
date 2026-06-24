import { useEffect, useState } from "react";
import { fetchAiProviderInfo, type AiProviderInfo } from "../api/supernova";
import type { SheetTable } from "../types";
import { ClinicalPreCdFeedPanel } from "./ClinicalPreCdFeedPanel";
import { RefreshControls } from "./RefreshControls";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { LossRescuePanel } from "./LossRescuePanel";
import { useT, useLang } from "../shared/i18n";

type CatalystFeedTab = "feed" | "rescue";

export function CatalystFeedView({
  simTable,
  reloadSnapshotToken = 0,
  initialTickerFilter = null,
  onInitialTickerFilterConsumed,
  onReloadSnapshot,
  onOpenSimulationRow,
}: {
  simTable?: SheetTable | null;
  reloadSnapshotToken?: number;
  initialTickerFilter?: string | null;
  onInitialTickerFilterConsumed?: () => void;
  onReloadSnapshot?: () => void;
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string; rowKey?: string }) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [tab, setTab] = useState<CatalystFeedTab>("feed");
  const [aiProvider, setAiProvider] = useState<AiProviderInfo | null>(null);

  useEffect(() => {
    void fetchAiProviderInfo()
      .then(setAiProvider)
      .catch(() => setAiProvider(null));
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 feed-panel-shell">
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-[rgb(var(--border))]/60">
        <SelectionChipGroup>
          <SelectionChip active={tab === "feed"} onClick={() => setTab("feed")}>
            {lang === "it" ? "News Feed" : "News Feed"}
          </SelectionChip>
          <SelectionChip active={tab === "rescue"} onClick={() => setTab("rescue")}>
            {lang === "it" ? "Loss Rescue" : "Loss Rescue"}
          </SelectionChip>
        </SelectionChipGroup>
        {tab === "feed" && (
          <div className="ml-auto">
            <RefreshControls
              onLocalReload={() => onReloadSnapshot?.()}
              reloadTooltip={t("refresh.page.catalystFeed.tooltip")}
            />
          </div>
        )}
      </div>

      {tab === "feed" ? (
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
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-3 py-2">
          <LossRescuePanel simTable={simTable ?? null} onOpenSimulationRow={onOpenSimulationRow} />
        </div>
      )}
    </div>
  );
}
