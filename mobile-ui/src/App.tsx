import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkHealth,
  fetchDesktopManifest,
  fetchMobileHostConfig,
  getApiBase,
  getApiToken,
  getSetupDefaultApiBase,
  isSameOriginMobileHost,
  isSetupDone,
  saveSimInputs,
  markSetupDone,
  setApiBase,
  setApiToken,
  postTesterFeedbackEvent,
} from "./api";
import type { MobileDashboardSnapshot } from "./dashboardTypes";
import type { InvestSimInputEntry, InvestSimInputs, SheetTable } from "./types";
import { AppHeader, SettingsSheet, TabBar } from "./MobileShell";
import { DetailScreen } from "./components/DetailScreen";
import { useMobilePriceReadingCache } from "./hooks/useMobilePriceReadingCache";
import { useRefresh } from "./hooks/useRefresh";
import { useMobileLang } from "./hooks/useMobileLang";
import { useTheme } from "./hooks/useTheme";
import { t as translate } from "./i18n";
import type { MobileLang } from "./langStorage";
import { DEFAULT_VPS_HOST } from "./remoteHost";
import { MOBILE_APP_VERSION } from "./version";
import {
  buildSimRowByKeyMap,
  computeSimulationPosition,
} from "./simLogic";
import { DashboardView } from "./views/DashboardView";
import { PortfolioView } from "./views/PortfolioView";
import { OpportunitiesView } from "./views/OpportunitiesView";
import { TesterGateView } from "./components/TesterGateView";
import { TesterWelcomeView } from "./components/TesterWelcomeView";
import { useTesterSession } from "./hooks/useTesterSession";

type Tab = "dashboard" | "portfolio" | "opportunities";
type Screen = "tabs" | "detail";

function mergeEntryForSave(
  prev: InvestSimInputEntry | undefined,
  buyPrice: number,
  capital: number,
  close: boolean,
): InvestSimInputEntry {
  if (close) {
    return {
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      ...(prev?.investedAt ? { investedAt: prev.investedAt } : {}),
      ...(prev?.purchaseDate ? { purchaseDate: prev.purchaseDate } : {}),
      soldAt: new Date().toISOString(),
    };
  }
  const next: InvestSimInputEntry = {
    buyPrice: Math.max(0, buyPrice),
    capital: Math.max(0, capital),
    ignoreSheet: false,
  };
  if (capital > 0 && buyPrice > 0 && !prev?.investedAt) {
    next.investedAt = new Date().toISOString();
  } else if (prev?.investedAt) {
    next.investedAt = prev.investedAt;
  }
  if (prev?.purchaseDate) next.purchaseDate = prev.purchaseDate;
  return next;
}

function connectionLabel(hostMode: "dev" | "v3" | "remote" | null, lang: MobileLang): string {
  const base = getApiBase();
  if (hostMode === "v3") return translate("connection.v3", lang);
  if (base) {
    try {
      return new URL(base).host;
    } catch {
      return base;
    }
  }
  return import.meta.env.DEV
    ? translate("connection.localDev", lang)
    : DEFAULT_VPS_HOST.replace(/^https?:\/\//, "");
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { lang, t } = useMobileLang();

  const [ready, setReady] = useState(isSetupDone());
  const [apiBaseInput, setApiBaseInput] = useState(() => getSetupDefaultApiBase());
  const [apiTokenInput, setApiTokenInput] = useState(() => getApiToken());
  const [hostMode, setHostMode] = useState<"dev" | "v3" | "remote" | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [screen, setScreen] = useState<Screen>("tabs");
  const sessionScreen = screen === "tabs" ? tab : screen;
  const {
    gate: testerGate,
    tester,
    access: testerAccess,
    authErr: testerAuthErr,
    authBusy: testerAuthBusy,
    register: registerTester,
    refreshAccess: refreshTesterAccess,
    signOutTester,
    inviteRequired,
  } = useTesterSession(sessionScreen);
  const { refresh, reloadOnly, loading: refreshLoading, lastUpdate } = useRefresh(tester?.testerId ?? null);

  const [detailBackTab, setDetailBackTab] = useState<Tab>("portfolio");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTable | null>(null);
  const [inputs, setInputs] = useState<InvestSimInputs>({});
  const [inputsUpdatedAt, setInputsUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [detailBuy, setDetailBuy] = useState("");
  const [detailCap, setDetailCap] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [dashSnapshot, setDashSnapshot] = useState<MobileDashboardSnapshot | null>(null);
  const [chartBundle, setChartBundle] = useState<import("./types").ChartBundle | null>(null);
  const [showWelcomeInstall, setShowWelcomeInstall] = useState(false);
  const [tokenOnlySetup, setTokenOnlySetup] = useState(() => isSameOriginMobileHost());
  const { simTableVersion, revision: priceReadingRevision } = useMobilePriceReadingCache(
    sheet,
    inputs,
  );

  const applyRefresh = useCallback((r: import("./hooks/useRefresh").RefreshResult) => {
    setSheet(r.sheet);
    if (r.workbookNote) setMsg(r.workbookNote);
    setInputs(r.inputs);
    setInputsUpdatedAt(r.inputsUpdatedAt);
    setDashSnapshot(r.dashSnapshot);
    setChartBundle(r.chartBundle);
    setApiOk(r.apiOk);
  }, []);

  const rowMap = useMemo(() => buildSimRowByKeyMap(sheet?.rows ?? []), [sheet]);
  const posByKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeSimulationPosition>>();
    for (const r of sheet?.rows ?? []) {
      const p = computeSimulationPosition(r, inputs);
      if (p) map.set(p.key, p);
    }
    return map;
  }, [sheet, inputs]);

  const selectedRow = selectedKey ? rowMap.get(selectedKey) : undefined;
  const selectedPos = selectedKey ? posByKey.get(selectedKey) : undefined;

  const resolveHostMode = useCallback(async (base: string) => {
    try {
      const cfg = await fetchMobileHostConfig();
      if (cfg.same_origin_pwa) return "v3" as const;
    } catch {
      /* ignore */
    }
    return base ? ("remote" as const) : ("dev" as const);
  }, []);

  const handleRefresh = useCallback(() => {
    setErr(null);
    void refresh(applyRefresh, (m) => setErr(m));
  }, [refresh, applyRefresh]);

  useEffect(() => {
    if (testerGate !== "ready") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("welcome") === "1";
      const fromSession = sessionStorage.getItem("sn_tester_show_welcome") === "1";
      if (fromUrl || fromSession) {
        setShowWelcomeInstall(true);
        sessionStorage.removeItem("sn_tester_show_welcome");
      }
    } catch {
      /* ignore */
    }
  }, [testerGate]);

  const dismissWelcomeInstall = useCallback(() => {
    setShowWelcomeInstall(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("welcome");
      url.searchParams.delete("email");
      const qs = url.searchParams.toString();
      window.history.replaceState({}, "", `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!ready || testerGate !== "ready") return;
    setErr(null);
    void reloadOnly(applyRefresh, (m) => setErr(m));
  }, [ready, testerGate, tester?.testerId, reloadOnly, applyRefresh]);

  /** Rilegge snapshot quando il server completa un refresh orario (manifest VPS). */
  const manifestSigRef = useRef("");
  useEffect(() => {
    if (!ready || testerGate !== "ready" || apiOk !== true) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const m = await fetchDesktopManifest();
        if (cancelled || !m) return;
        const sig = `${m.workbook_mtime ?? ""}|${m.updated_at ?? ""}`;
        if (manifestSigRef.current && manifestSigRef.current !== sig) {
          void reloadOnly(applyRefresh, (msg) => setErr(msg));
        }
        manifestSigRef.current = sig;
      } catch {
        /* manifest opzionale */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ready, testerGate, apiOk, reloadOnly, applyRefresh]);

  useEffect(() => {
    if (ready || isSetupDone()) return;
    void (async () => {
      try {
        await checkHealth();
        const cfg = await fetchMobileHostConfig();
        const sameOrigin = isSameOriginMobileHost() || !!cfg.same_origin_api;
        if (sameOrigin) {
          setTokenOnlySetup(true);
          setApiBase("");
          setApiBaseInput("");
        }
        if (cfg.same_origin_pwa && !cfg.api_token_required) {
          setApiBase("");
          setHostMode("v3");
          markSetupDone();
          setReady(true);
          return;
        }
        if (sameOrigin) {
          await checkHealth();
          setHostMode("remote");
          markSetupDone();
          setReady(true);
          return;
        }
      } catch {
        /* setup screen */
      }
    })();
  }, [ready]);

  useEffect(() => {
    if (!selectedKey || !selectedRow) return;
    const p = selectedPos ?? computeSimulationPosition(selectedRow, inputs);
    const hasPosition = (p?.capital ?? 0) > 0;
    if (hasPosition && p) {
      setDetailBuy(p.buyPrice > 0 ? String(p.buyPrice) : "");
      setDetailCap(String(p.capital));
      return;
    }
    const price = p?.currPrice;
    setDetailBuy(price != null && price > 0 ? String(price) : "");
    setDetailCap("");
  }, [selectedKey, selectedPos, selectedRow, inputs]);

  const saveSetup = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (tokenOnlySetup) {
        setApiBase("");
      } else {
        setApiBase(apiBaseInput);
      }
      setApiToken(apiTokenInput);
      const mode = tokenOnlySetup ? ("remote" as const) : await resolveHostMode(apiBaseInput.trim());
      setHostMode(mode);
      await checkHealth();
      markSetupDone();
      setReady(true);
      setScreen("tabs");
      setMsg(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const useVpsPreset = () => setApiBaseInput(DEFAULT_VPS_HOST);

  const persistInputs = async (next: InvestSimInputs, note: string) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await saveSimInputs(next, tester?.testerId ?? null);
      setInputs(next);
      setInputsUpdatedAt(new Date().toISOString());
      setMsg(note);
      void reloadOnly(applyRefresh, (m) => setErr(m));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = (key: string, fromTab?: Tab) => {
    setSelectedKey(key);
    setDetailBackTab(fromTab ?? tab);
    setScreen("detail");
    setMsg(null);
    setErr(null);
  };

  const closeDetail = () => {
    setScreen("tabs");
    setSelectedKey(null);
  };

  const saveDetail = () => {
    if (!selectedKey) return;
    const buy = Number(detailBuy.replace(",", "."));
    const cap = Number(detailCap.replace(",", "."));
    if (!Number.isFinite(buy) || buy < 0 || !Number.isFinite(cap) || cap < 0) {
      setErr(t("error.invalidPriceCapital"));
      return;
    }
    const next = { ...inputs, [selectedKey]: mergeEntryForSave(inputs[selectedKey], buy, cap, false) };
    void persistInputs(next, t("msg.saved"));
  };

  const closePosition = () => {
    if (!selectedKey || !selectedRow) return;
    const closedPos = selectedPos ?? computeSimulationPosition(selectedRow, inputs);
    const next = { ...inputs, [selectedKey]: mergeEntryForSave(inputs[selectedKey], 0, 0, true) };
    void (async () => {
      await persistInputs(next, t("msg.positionClosed"));
      if (tester?.testerId && closedPos && closedPos.capital > 0 && !closedPos.pnlUnavailable) {
        try {
          await postTesterFeedbackEvent({
            tester_id: tester.testerId,
            display_name: tester.displayName,
            module: "portfolio",
            kind: "gain_note",
            source: "mobile",
            ticker: closedPos.ticker,
            payload: {
              email: tester.email,
              action: "close",
              pnl_eur: Math.round(closedPos.pnlEur * 100) / 100,
              pnl_pct: Math.round(closedPos.pnlPct * 100) / 100,
              capital_eur: closedPos.capital,
              buy_price: closedPos.buyPrice,
              sell_price: closedPos.currPrice,
            },
          });
        } catch {
          /* non-blocking */
        }
      }
      closeDetail();
    })();
  };

  const backLabel =
    detailBackTab === "dashboard"
      ? t("nav.dashboard")
      : detailBackTab === "opportunities"
        ? t("nav.opportunities")
        : t("nav.portfolio");

  if (!ready) {
    return (
      <div className="app-shell">
        <AppHeader subtitle={`v${MOBILE_APP_VERSION} · ${t("connection.subtitle")}`} theme={theme} onToggleTheme={toggleTheme} />
        <main className="app-main">
          <div className="card">
            <h2>{t("connection.title")}</h2>
            {!tokenOnlySetup ? (
              <div className="field">
                <label>{t("connection.apiUrlHint")}</label>
                <input value={apiBaseInput} onChange={(e) => setApiBaseInput(e.target.value)} placeholder={DEFAULT_VPS_HOST} />
              </div>
            ) : (
              <p className="hint">{t("connection.tokenOnlyHint")}</p>
            )}
            <div className="field">
              <label>{t("connection.apiToken")}</label>
              <input
                type="password"
                value={apiTokenInput}
                onChange={(e) => setApiTokenInput(e.target.value)}
                placeholder={t("connection.tokenPlaceholder")}
                autoComplete="off"
              />
            </div>
            {!tokenOnlySetup ? (
              <p className="hint">{t("connection.hint", { host: DEFAULT_VPS_HOST })}</p>
            ) : null}
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveSetup()}>
                {busy ? "…" : t("connection.connect")}
              </button>
              {!tokenOnlySetup ? (
                <button type="button" className="btn btn-outline" disabled={busy} onClick={useVpsPreset}>
                  {t("connection.useVps")}
                </button>
              ) : null}
            </div>
            {err ? <p className="msg err">{err}</p> : null}
          </div>
        </main>
      </div>
    );
  }

  if (testerGate !== "ready") {
    const gateMode =
      testerGate === "loading"
        ? "loading"
        : testerGate === "needs_register"
          ? "register"
          : testerGate === "pending"
            ? "pending"
            : "revoked";
    return (
      <div className="app-shell">
        <AppHeader
          subtitle={`v${MOBILE_APP_VERSION} · ${t("tester.access")}`}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className="app-main">
          <TesterGateView
            mode={gateMode}
            tester={tester}
            authBusy={testerAuthBusy}
            authErr={testerAuthErr}
            inviteRequired={inviteRequired}
            onRegister={(email, name, code) => void registerTester(email, name, code)}
            onRefresh={() => void refreshTesterAccess()}
            onSignOut={signOutTester}
            onEnterApproved={(email) => void registerTester(email, email.split("@")[0] || email, "")}
          />
        </main>
      </div>
    );
  }

  if (showWelcomeInstall) {
    return <TesterWelcomeView onContinue={dismissWelcomeInstall} />;
  }

  if (screen === "detail" && selectedRow && selectedKey) {
    return (
      <div className="app-shell">
        <AppHeader
          title={selectedPos?.ticker ?? String(selectedRow.Ticker)}
          subtitle={`v${MOBILE_APP_VERSION}`}
          onBack={closeDetail}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <DetailScreen
          row={selectedRow}
          pos={selectedPos ?? undefined}
          detailBuy={detailBuy}
          detailCap={detailCap}
          setDetailBuy={setDetailBuy}
          setDetailCap={setDetailCap}
          busy={busy}
          err={err}
          msg={msg}
          backLabel={backLabel}
          onBack={closeDetail}
          onSave={saveDetail}
          onClose={closePosition}
        />
      </div>
    );
  }

  const headerSub =
    tab === "dashboard"
      ? t("nav.dashboard")
      : tab === "portfolio"
        ? t("nav.myPortfolio")
        : t("nav.opportunities");

  return (
    <div className="app-shell">
      <AppHeader
        tab={tab}
        subtitle={`${headerSub} · v${MOBILE_APP_VERSION}`}
        apiOk={apiOk}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="app-main">
        {err ? <p className="msg err">{err}</p> : null}
        {msg && screen === "tabs" ? <p className="msg ok">{msg}</p> : null}

        {tab === "dashboard" && (
          <DashboardView
            sheet={sheet}
            inputs={inputs}
            dashSnapshot={dashSnapshot}
            chartBundle={chartBundle}
            refreshLoading={refreshLoading}
            lastUpdate={lastUpdate}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRefresh={handleRefresh}
            onOpenDetail={(k) => openDetail(k, "dashboard")}
            onGoPortfolio={() => setTab("portfolio")}
            onGoOpportunities={() => setTab("opportunities")}
            simTableVersion={simTableVersion}
            priceReadingRevision={priceReadingRevision}
          />
        )}

        {tab === "portfolio" && (
          <PortfolioView
            sheet={sheet}
            inputs={inputs}
            dashSnapshot={dashSnapshot}
            refreshLoading={refreshLoading}
            lastUpdate={lastUpdate}
            onRefresh={handleRefresh}
            onOpenDetail={(k) => openDetail(k, "portfolio")}
          />
        )}

        {tab === "opportunities" && (
          <OpportunitiesView
            sheet={sheet}
            inputs={inputs}
            dashSnapshot={dashSnapshot}
            inputsUpdatedAt={inputsUpdatedAt}
            refreshLoading={refreshLoading}
            lastUpdate={lastUpdate}
            onRefresh={handleRefresh}
            onOpenDetail={(k) => openDetail(k, "opportunities")}
          />
        )}
      </main>
      <TabBar active={tab} onChange={setTab} />
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiBaseInput={apiBaseInput}
        setApiBaseInput={setApiBaseInput}
        apiTokenInput={apiTokenInput}
        setApiTokenInput={setApiTokenInput}
        inputsUpdatedAt={inputsUpdatedAt}
        busy={busy}
        connectionLabel={connectionLabel(hostMode, lang)}
        apiOk={apiOk}
        onPipelineDone={handleRefresh}
        testerEmail={tester?.email ?? testerAccess?.email ?? null}
        onSignOutTester={signOutTester}
        onSave={() => {
          setApiBase(apiBaseInput);
          setApiToken(apiTokenInput);
          void resolveHostMode(apiBaseInput.trim()).then(setHostMode);
          handleRefresh();
        }}
        onReset={() => {
          localStorage.removeItem("sn_short_setup_done");
          setSettingsOpen(false);
          setReady(false);
        }}
      />
    </div>
  );
}
