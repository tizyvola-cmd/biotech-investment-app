/**
 * PageRefreshControls — un solo pulsante Refresh per pagina.
 *
 * Rilegge snapshot JSON e ricalcoli locali della pagina corrente.
 * I refresh server pesanti (CD scan, daily, domenica) sono in System → Refresh
 * o automatici sul VPS (scheduler).
 */

import { useCallback, useState } from "react";
import { RefreshLiveBadge } from "./InvestmentDecisionLabView";
import {
  markReloadCompleted,
  setRefreshModalOpen,
  useRefreshStatus,
} from "../shared/refreshStatusStore";
import { formatDataRefreshTimestamp } from "../shared/dataFreshness";
import { useLang, useT } from "../shared/i18n";

export function RefreshControls({
  onLocalReload,
  onRefresh,
  localLoading,
  loading,
  localLoadingLabel,
  loadingLabel,
  reloadTooltip,
  tooltip,
  extraInfo,
  className,
  dataUpdatedAt: _dataUpdatedAt,
}: {
  /** @deprecated use onRefresh */
  onLocalReload?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  /** @deprecated use loading */
  localLoading?: boolean;
  loading?: boolean;
  localLoadingLabel?: string;
  loadingLabel?: string;
  /** @deprecated use tooltip */
  reloadTooltip?: string;
  tooltip?: string;
  extraInfo?: string;
  className?: string;
  /** @deprecated unused in UI — server snapshot shown in System only */
  dataUpdatedAt?: string | null;
}) {
  const [reloadFlash, setReloadFlash] = useState(false);
  const { life, finishedAt, lastReloadAt } = useRefreshStatus();
  const t = useT();
  const { lang } = useLang();
  const refreshInFlight =
    life.state === "starting" ||
    life.state === "running" ||
    life.state === "exporting" ||
    life.state === "post-pipeline";

  const runRefresh = onRefresh ?? onLocalReload ?? (() => undefined);
  const busy = loading ?? localLoading ?? false;
  const busyLabel = loadingLabel ?? localLoadingLabel;
  const tip = tooltip ?? reloadTooltip ?? t("refresh.page.default.tooltip");
  const pageReloadLabel = lastReloadAt
    ? formatDataRefreshTimestamp(lastReloadAt.toISOString(), lang === "it" ? "it" : "en")
    : null;
  const statusTitle = [
    tip,
    extraInfo,
    pageReloadLabel ? `${t("refresh.controls.lastPageRefresh")}: ${pageReloadLabel}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const handleRefresh = useCallback(async () => {
    setReloadFlash(false);
    try {
      await runRefresh();
    } finally {
      markReloadCompleted();
      setReloadFlash(true);
      window.setTimeout(() => setReloadFlash(false), 1500);
    }
  }, [runRefresh]);

  return (
    <div className={`flex flex-col items-end gap-0.5 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`btn-ghost text-xs disabled:opacity-50 transition-colors ${
            reloadFlash ? "bg-positive/15 text-positive" : ""
          }`}
          disabled={busy}
          onClick={() => { void handleRefresh(); }}
          title={statusTitle}
        >
          {busy
            ? (busyLabel ?? t("common.reloading"))
            : reloadFlash
              ? t("common.reloaded")
              : t("common.refreshPage")}
        </button>
        {(refreshInFlight || life.state !== "idle") && (
          <RefreshLiveBadge
            info={life}
            finishedAt={finishedAt}
            onOpenModal={() => setRefreshModalOpen(true)}
          />
        )}
      </div>
      {pageReloadLabel ? (
        <span
          className="text-[10px] text-ink-muted/70 leading-none tabular-nums text-right"
          title={statusTitle}
        >
          {t("refresh.controls.lastPageRefresh")}: {pageReloadLabel}
        </span>
      ) : null}
    </div>
  );
}

/** @deprecated alias */
export const PageRefreshControls = RefreshControls;
