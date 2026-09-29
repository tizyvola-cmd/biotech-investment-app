/**
 * Catalyst page Refresh — lives in AppTopBar (top-right, where the bell was).
 */
import { useSyncExternalStore } from "react";
import { RefreshControls } from "./RefreshControls";
import {
  getPageRefreshState,
  runRegisteredPageRefresh,
  subscribePageRefresh,
} from "../sheet/pageRefreshBridge";
import { useLang, useT } from "../shared/i18n";

export function CatalystTopRefresh() {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const snap = useSyncExternalStore(
    subscribePageRefresh,
    getPageRefreshState,
    getPageRefreshState,
  );

  return (
    <RefreshControls
      onRefresh={() => runRegisteredPageRefresh()}
      loading={snap.loading}
      loadingLabel={it ? "Aggiorno…" : "Updating…"}
      tooltip={snap.tooltip ?? t("refresh.page.catalyst.tooltip")}
      className="items-end"
      compact
    />
  );
}
