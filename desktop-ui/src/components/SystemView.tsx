import { useCallback, useEffect, useState } from "react";
import type { ResolvedTheme } from "../sheet/themePrefs";
import type { ApiStatus } from "../types";
import {
  RefreshView,
  type RefreshTabProfileId,
} from "./RefreshView";
import { Settings } from "./Settings";
import { SystemOwnershipPanel } from "./SystemOwnershipPanel";
import { AiApiKeysPanel } from "./AiApiKeysPanel";
import { AiProviderSwitch } from "./AiProviderSwitch";
import { useT, useLang } from "../shared/i18n";
import { exportDesktopSnapshots, runRefreshProfile } from "../api/refresh";
import { fetchAiProviderInfo, fetchRefreshStatus, type AiProviderInfo } from "../api/supernova";
import { setRefreshDurationClass, setRefreshProfile } from "../shared/refreshStatusStore";
import {
  effectiveRegime,
  loadMarketGateBypass,
  loadMarketContextDoc,
  regimePillClass,
  type MarketContextDoc,
  type MarketRegime,
} from "../sheet/marketContextGate";

export function SystemView({
  apiOk,
  busy,
  onBusyChange,
  onRefreshComplete,
  onBeforeRefreshStart,
  status,
  log,
  onRefreshStatus,
  theme,
  onTheme,
}: {
  apiOk: boolean | null;
  busy: boolean;
  onBusyChange: (b: boolean) => void;
  onRefreshComplete: () => void;
  onBeforeRefreshStart?: () => void;
  status: ApiStatus | null;
  log: string;
  onRefreshStatus: () => void;
  theme: ResolvedTheme;
  onTheme: (t: ResolvedTheme) => void;
}) {
  const [panel, setPanel] = useState<"refresh" | "settings" | "about" | "ai">("ai");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [marketCtx, setMarketCtx] = useState<MarketContextDoc | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProviderInfo | null>(null);
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  useEffect(() => {
    void loadMarketContextDoc().then(setMarketCtx).catch(() => setMarketCtx(null));
  }, [busy]);

  useEffect(() => {
    if (panel !== "ai") return;
    void fetchAiProviderInfo()
      .then(setAiProvider)
      .catch(() => setAiProvider(null));
  }, [panel]);

  const regime: MarketRegime = effectiveRegime(marketCtx);
  const gateBypass = loadMarketGateBypass();

  const tabs: {
    id: "refresh" | "settings" | "about" | "ai";
    labelKey:
      | "system.tab.refresh"
      | "system.tab.settings"
      | "system.tab.about"
      | "system.tab.ai";
  }[] = [
    { id: "refresh", labelKey: "system.tab.refresh" },
    { id: "ai", labelKey: "system.tab.ai" },
    { id: "settings", labelKey: "system.tab.settings" },
    { id: "about", labelKey: "system.tab.about" },
  ];

  const startRefreshProfile = useCallback(
    async (id: RefreshTabProfileId) => {
      setRefreshError(null);
      onBeforeRefreshStart?.();
      if (id === "sunday") {
        setRefreshProfile("sunday");
        setRefreshDurationClass("long");
      } else {
        setRefreshProfile("daily");
        setRefreshDurationClass("long");
      }
      onBusyChange(true);
      const res = await runRefreshProfile(id);
      if (res.error) {
        setRefreshError(res.error);
        onBusyChange(false);
        throw new Error(res.error);
      }
    },
    [onBeforeRefreshStart, onBusyChange],
  );

  useEffect(() => {
    if (!busy || apiOk !== true) return;
    const id = window.setInterval(async () => {
      const st = await fetchRefreshStatus();
      onRefreshStatus();
      if (!st.running) {
        onBusyChange(false);
        try {
          await exportDesktopSnapshots();
        } catch {
          /* optional */
        }
        onRefreshComplete();
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [busy, apiOk, onBusyChange, onRefreshComplete, onRefreshStatus]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--border))]/60 pb-3 shrink-0">
        <div className="mr-2">
          <h2 className="text-lg font-semibold">{t("system.header.title")}</h2>
          <p className="text-xs text-ink-muted">{t("system.header.subtitle")}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${regimePillClass(regime)}`}
          title={
            marketCtx?.gate_reason ??
            (marketCtx?.signals?.xbi_5d_return != null
              ? `XBI 5d: ${marketCtx.signals.xbi_5d_return}%`
              : undefined)
          }
        >
          {regime === "RISK_ON"
            ? t("marketGate.pill.riskOn")
            : regime === "RISK_OFF"
              ? t("marketGate.pill.riskOff")
              : regime === "CRISIS"
                ? t("marketGate.pill.crisis")
                : t("marketGate.pill.neutral")}
          {gateBypass ? ` · ${t("marketGate.pill.bypass")}` : ""}
        </span>
        <div className="flex gap-1 p-0.5 rounded-lg bg-surface border border-[rgb(var(--border))]/60 ml-auto">
          {tabs.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs transition ${
                panel === id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setPanel(id)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col pt-3 pb-4 overflow-y-auto overflow-x-hidden">
        {panel === "refresh" && (
          <RefreshView
            apiOk={apiOk}
            busy={busy}
            onBusyChange={onBusyChange}
            onBeforeRefreshStart={onBeforeRefreshStart}
            onStartProfile={startRefreshProfile}
          />
        )}
        {panel === "ai" && (
          <div className="max-w-2xl space-y-3 pb-6">
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {it ? "Piattaforme AI" : "AI platforms"}
              </h3>
              <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
                {it
                  ? "Inserisci le API key e scegli il provider attivo. Claude per qualità; Gemini gratis come fallback."
                  : "Paste API keys and pick the active provider. Claude for quality; Gemini free as fallback."}
              </p>
            </div>
            <AiProviderSwitch info={aiProvider} onUpdated={setAiProvider} />
            <AiApiKeysPanel defaultOpen onProviderUpdate={setAiProvider} />
          </div>
        )}
        {panel === "settings" && (
          <Settings
            apiOk={apiOk}
            status={status}
            log={log}
            onRefreshStatus={onRefreshStatus}
            busy={busy}
            theme={theme}
            onTheme={onTheme}
            refreshError={refreshError}
          />
        )}
        {panel === "about" && <SystemOwnershipPanel />}
      </div>
    </div>
  );
}
