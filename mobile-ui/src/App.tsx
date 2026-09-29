import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkHealth,
  fetchCompanionSimInputs,
  fetchDesktopManifest,
  fetchMobileDashboardSnapshot,
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
import type { InvestSimInputs, SheetTable } from "./types";
import { AppHeader, SettingsSheet } from "./MobileShell";
import { DetailScreen } from "./components/DetailScreen";
import { useMobilePriceReadingCache } from "./hooks/useMobilePriceReadingCache";
import { useMobileScoreEnrichment } from "./hooks/useMobileScoreEnrichment";
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
  fmtUsd,
} from "./simLogic";
import { getNasdaqStatus } from "./marketHours";
import { DashboardView } from "./views/DashboardView";
import { TesterGateView } from "./components/TesterGateView";
import { TesterWelcomeView } from "./components/TesterWelcomeView";
import { OpportunityDetailView } from "./views/OpportunityDetailView";
import { OpportunityScreenNav } from "./components/OpportunityScreenNav";
import { AutoSoldModal } from "./components/AutoSoldModal";
import { RecTradeModal, type RecTradeDraft } from "./components/RecTradeModal";
import { ackAutoSoldEvent, shouldShowAutoSold } from "./autoSoldAck";
import { pushAutoSoldOsNotification } from "./mobileRiskAlerts";
import { useSimStartingCapital } from "./hooks/useSimStartingCapital";
import { useTesterSession } from "./hooks/useTesterSession";
import { investBookTesterIdForEmail } from "./testerSession";
import type { MobileAutoSoldEvent } from "./dashboardTypes";
import { suggestedInvestEur, suggestedInvestPctForBuy } from "./mobileBuySizing";
import { mobileSimCash } from "./mobilePortfolioCash";
import { resolveMobileDecisionRow } from "./mobileDecisionChartBuild";
import {
  alignOpenBookToDesktopPulse,
  mergeEntryForSave,
  openBookCapital,
  openKeysFromPositions,
  preferLocalBookIfFresher,
  RECENT_MOBILE_BUY_MS,
  resolveMobileTradeTarget,
  restoreOpensFromPulseAuthority,
  unionOpenBooks,
} from "./mobileTradeBook";

/** Mobile companion is dashboard-only; detail/opportunity are drill-downs. */
type Screen = "dashboard" | "detail" | "opportunity";

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

function DevModeBanner({ text }: { text: string }) {
  if (!import.meta.env.DEV) return null;
  return <p className="msg warn dev-mode-banner">{text}</p>;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { lang, t } = useMobileLang();

  const [ready, setReady] = useState(isSetupDone());
  const [apiBaseInput, setApiBaseInput] = useState(() => getSetupDefaultApiBase());
  const [apiTokenInput, setApiTokenInput] = useState(() => getApiToken());
  const [hostMode, setHostMode] = useState<"dev" | "v3" | "remote" | null>(null);
  const [screen, setScreen] = useState<Screen>("dashboard");
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
  } = useTesterSession(screen);
  const investBookTesterId = investBookTesterIdForEmail(tester?.email, tester?.testerId);
  const { refresh, reloadOnly, loading: refreshLoading, lastUpdate } = useRefresh(investBookTesterId);

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
  const [autoSoldPopup, setAutoSoldPopup] = useState<MobileAutoSoldEvent | null>(null);
  const [recTrade, setRecTrade] = useState<RecTradeDraft | null>(null);
  const [recTradeErr, setRecTradeErr] = useState<string | null>(null);
  const [oppTradeErr, setOppTradeErr] = useState<string | null>(null);
  const [bookSource, setBookSource] = useState<"shared" | "tester" | "empty">("empty");
  const [clinicalRecordsMerged, setClinicalRecordsMerged] = useState<import("./api").ClinicalPreCdRecord[]>([]);
  const [chartBundle, setChartBundle] = useState<import("./types").ChartBundle | null>(null);
  const [showWelcomeInstall, setShowWelcomeInstall] = useState(false);
  const [tokenOnlySetup, setTokenOnlySetup] = useState(() => isSameOriginMobileHost());
  const inputsRef = useRef<InvestSimInputs>({});
  const inputsUpdatedAtRef = useRef<string | null>(null);
  const persistBusyRef = useRef(false);
  inputsRef.current = inputs;
  inputsUpdatedAtRef.current = inputsUpdatedAt;
  const { simTableVersion, revision: priceReadingRevision } = useMobilePriceReadingCache(
    sheet,
    inputs,
  );
  const scoreEnrichment = useMobileScoreEnrichment();
  const { startingCapital, setStartingCapital } = useSimStartingCapital();

  const applyRefresh = useCallback((r: import("./hooks/useRefresh").RefreshResult) => {
    setSheet(r.sheet);
    if (r.workbookNote) setMsg(r.workbookNote);
    if (r.snapshotSyncWarning) setErr(r.snapshotSyncWarning);
    // Never let a concurrent snapshot poll wipe a Soft BUY/SELL just saved.
    let mergedInputs = preferLocalBookIfFresher(
      inputsRef.current,
      inputsUpdatedAtRef.current,
      r.inputs,
      r.inputsUpdatedAt,
    );
    // Operator Pulse openPositions — skip for per-email tester books.
    const pulseKeys =
      r.bookSource === "tester"
        ? new Set<string>()
        : openKeysFromPositions(r.dashSnapshot?.openPositions);
    const pulseAuthority =
      r.dashSnapshot?.investSimInputs ?? r.inputs ?? null;
    if (pulseKeys.size > 0) {
      mergedInputs = restoreOpensFromPulseAuthority(
        mergedInputs,
        pulseAuthority,
        pulseKeys,
      );
      mergedInputs = alignOpenBookToDesktopPulse(mergedInputs, pulseKeys);
      mergedInputs = restoreOpensFromPulseAuthority(
        mergedInputs,
        pulseAuthority,
        pulseKeys,
      );
    }
    setInputs(mergedInputs);
    const localMs = inputsUpdatedAtRef.current
      ? Date.parse(inputsUpdatedAtRef.current)
      : 0;
    const remoteMs = r.inputsUpdatedAt ? Date.parse(r.inputsUpdatedAt) : 0;
    setInputsUpdatedAt(
      localMs >= remoteMs && inputsUpdatedAtRef.current
        ? inputsUpdatedAtRef.current
        : r.inputsUpdatedAt,
    );
    setDashSnapshot((prev) => {
      const base = r.dashSnapshot;
      if (!base) return base;
      const stamp =
        localMs >= remoteMs && inputsUpdatedAtRef.current
          ? inputsUpdatedAtRef.current
          : base.investSimInputsUpdatedAt ?? r.inputsUpdatedAt ?? undefined;
      const unioned = unionOpenBooks(
        mergedInputs,
        base.investSimInputs ?? prev?.investSimInputs,
      );
      const book =
        pulseKeys.size > 0
          ? restoreOpensFromPulseAuthority(
              alignOpenBookToDesktopPulse(unioned, pulseKeys),
              base.investSimInputs ?? pulseAuthority,
              pulseKeys,
            )
          : unioned;
      // Keep Soft BUY rows visible in openPositions before desktop Home republish.
      const now = Date.now();
      const openFromBook = Object.entries(book)
        .filter(
          ([, e]) =>
            e &&
            !e.ignoreSheet &&
            (e.capital ?? 0) > 0 &&
            (e.buyPrice ?? 0) > 0,
        )
        .map(([key, e]) => {
          const inv = e!.investedAt ? Date.parse(e!.investedAt) : NaN;
          const recent =
            Number.isFinite(inv) && now - inv >= 0 && now - inv < RECENT_MOBILE_BUY_MS;
          return { key, e: e!, recent };
        });
      const baseOpen = base.openPositions ?? prev?.openPositions ?? [];
      const baseKeys = new Set(baseOpen.map((p) => p.key));
      const extras = openFromBook
        .filter((x) => x.recent && !baseKeys.has(x.key))
        .map(({ key, e }) => ({
          key,
          ticker: key.split("|")[0]?.toUpperCase() || key,
          capitalEur: e.capital,
          pnlEur: 0,
          pnlPct: 0,
          investedAt: e.investedAt ?? null,
          recAction: "hold" as const,
        }));
      const openPositions =
        extras.length > 0 ? [...baseOpen, ...extras] : base.openPositions;
      return {
        ...base,
        investSimInputs: book,
        ...(openPositions ? { openPositions } : {}),
        ...(stamp ? { investSimInputsUpdatedAt: stamp } : {}),
      };
    });
    setBookSource(r.bookSource ?? "empty");
    setClinicalRecordsMerged(r.clinicalRecordsMerged ?? []);
    setChartBundle(r.chartBundle);
    setApiOk(r.apiOk);
    const ev = r.dashSnapshot?.autoSold ?? null;
    if (shouldShowAutoSold(ev)) setAutoSoldPopup(ev);
  }, []);

  const dismissAutoSoldPopup = useCallback(() => {
    setAutoSoldPopup((prev) => {
      if (prev?.id) ackAutoSoldEvent(prev.id);
      return null;
    });
  }, []);

  useEffect(() => {
    const ev = dashSnapshot?.autoSold ?? null;
    if (shouldShowAutoSold(ev)) setAutoSoldPopup(ev);
  }, [dashSnapshot?.autoSold]);

  useEffect(() => {
    if (!autoSoldPopup) return;
    void pushAutoSoldOsNotification(autoSoldPopup, lang === "it");
  }, [autoSoldPopup, lang]);

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

  const openRecTrade = useCallback(
    (key: string, side: "buy" | "sell") => {
      const target = resolveMobileTradeTarget(key, sheet, inputs);
      const { canonKey, ticker, pos, priceUsd: price } = target;
      let suggested: number | null = null;
      if (side === "buy") {
        const cash = mobileSimCash(inputs, sheet, startingCapital);
        const base = cash.invested > 0 ? cash.invested : cash.startingCapital;
        const decision = resolveMobileDecisionRow(
          canonKey,
          sheet,
          inputs,
          dashSnapshot,
          scoreEnrichment,
        );
        if (decision?.rec === "buy") {
          suggested = suggestedInvestEur(base, suggestedInvestPctForBuy(decision.scores));
        } else {
          suggested = suggestedInvestEur(base, 10);
        }
        const softBuy =
          dashSnapshot?.softBuys?.find((b) => b.key === key) ??
          dashSnapshot?.softBuys?.find((b) => b.key === canonKey);
        const mult =
          softBuy?.capitalMult != null && softBuy.capitalMult > 0
            ? softBuy.capitalMult
            : softBuy?.gateTier === "strong"
              ? 1
              : softBuy?.gateTier === "mid"
                ? 0.7
                : softBuy?.gateTier === "weak"
                  ? 0.4
                  : null;
        if (suggested != null && mult != null) {
          suggested = Math.max(50, Math.round((suggested * mult) / 50) * 50);
        }
      }
      setRecTradeErr(null);
      setRecTrade({
        key: canonKey,
        ticker,
        side,
        priceUsd: price,
        suggestedCapitalEur: suggested,
        openCapitalEur: pos?.capital ?? null,
        openPnlEur: pos && !pos.pnlUnavailable ? pos.pnlEur : null,
        openPnlPct: pos && !pos.pnlUnavailable ? pos.pnlPct : null,
      });
    },
    [inputs, sheet, startingCapital, dashSnapshot, scoreEnrichment],
  );

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

  /** Rilegge quando cambiano workbook, snapshot Soft, o libro buy/sell (sim-inputs). */
  const manifestSigRef = useRef("");
  const pollBackoffMsRef = useRef(0);
  useEffect(() => {
    if (!ready || testerGate !== "ready" || apiOk !== true) return;
    let cancelled = false;
    let timer: number | null = null;
    const BASE_POLL_MS = 90_000; // 60–120s band with jitter (was 12s — kills origin at scale)
    const JITTER_MS = 30_000;

    const scheduleNext = () => {
      if (cancelled) return;
      const backoff = pollBackoffMsRef.current;
      const jitter = Math.floor(Math.random() * JITTER_MS);
      const delay = Math.min(10 * 60_000, BASE_POLL_MS + jitter + backoff);
      timer = window.setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async () => {
      if (document.visibilityState === "hidden") {
        scheduleNext();
        return;
      }
      try {
        const testerId = tester?.testerId ?? null;
        const [m, snap, book] = await Promise.all([
          fetchDesktopManifest().catch(() => null),
          fetchMobileDashboardSnapshot().catch(() => null),
          fetchCompanionSimInputs(testerId).catch(() => null),
        ]);
        if (cancelled) return;
        pollBackoffMsRef.current = 0;
        const sig = `${m?.workbook_mtime ?? ""}|${m?.updated_at ?? ""}|${snap?.updated_at ?? ""}|${book?.updated_at ?? ""}`;
        if (manifestSigRef.current && manifestSigRef.current !== sig) {
          if (persistBusyRef.current) {
            scheduleNext();
            return;
          }
          void reloadOnly(applyRefresh, (msg) => setErr(msg));
        }
        if (sig.replace(/\|/g, "")) manifestSigRef.current = sig;
      } catch {
        pollBackoffMsRef.current = Math.min(
          10 * 60_000,
          Math.max(15_000, (pollBackoffMsRef.current || 15_000) * 2),
        );
      }
      scheduleNext();
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [ready, testerGate, apiOk, reloadOnly, applyRefresh, tester?.testerId]);

  /** Keep BUY/SELL price live while on opportunity or trade modal is open. */
  useEffect(() => {
    if (!ready || testerGate !== "ready") return;
    const needLivePrice = screen === "opportunity" || recTrade != null;
    if (!needLivePrice) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (persistBusyRef.current) return;
      void reloadOnly(applyRefresh, () => undefined);
    }, 45_000);
    return () => window.clearInterval(id);
  }, [ready, testerGate, screen, recTrade, reloadOnly, applyRefresh]);

  /** Sync Soft BUY modal price to the latest sheet quote (not a frozen open snapshot). */
  useEffect(() => {
    if (!recTrade || recTrade.side !== "buy") return;
    const target = resolveMobileTradeTarget(recTrade.key, sheet, inputs);
    const live = target.priceUsd;
    if (live == null || !(live > 0)) return;
    if (recTrade.priceUsd != null && Math.abs(recTrade.priceUsd - live) < 1e-6) return;
    setRecTrade((prev) =>
      prev && prev.key === recTrade.key
        ? { ...prev, key: target.canonKey || prev.key, priceUsd: live }
        : prev,
    );
  }, [recTrade, sheet, inputs]);

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
      setScreen("dashboard");
      setMsg(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const useVpsPreset = () => setApiBaseInput(DEFAULT_VPS_HOST);

  const persistInputs = async (
    next: InvestSimInputs,
    note: string,
    opts?: {
      /** Optimistic openPositions patch so the portfolio list updates before desktop republish. */
      openPositionPatch?: {
        key: string;
        ticker: string;
        capitalEur: number;
        buyPrice: number;
      } | null;
      /** Soft SELL — drop key from snapshot openPositions immediately. */
      removeOpenKey?: string | null;
    },
  ) => {
    setBusy(true);
    persistBusyRef.current = true;
    setErr(null);
    setMsg(null);
    const savedAt = new Date().toISOString();
    try {
      if (!tester?.email) {
        throw new Error(
          lang === "it"
            ? "Accedi con la stessa email del desktop prima di salvare il book."
            : "Sign in with the same desktop email before saving the book.",
        );
      }
      // Always the email-bound book (shared Pulse only for the deployment owner).
      const effectiveTesterId = investBookTesterIdForEmail(tester.email, tester.testerId);
      await saveSimInputs(next, effectiveTesterId);
      if (effectiveTesterId) {
        setBookSource("tester");
      } else {
        setBookSource("shared");
      }
      // Apply locally first so BUY/SELL stays visible even if a concurrent
      // snapshot reload races (desktop openPositions lag behind sim-inputs).
      setInputs(next);
      setInputsUpdatedAt(savedAt);
      inputsRef.current = next;
      inputsUpdatedAtRef.current = savedAt;
      setDashSnapshot((prev) => {
        if (!prev) return prev;
        let openPositions = prev.openPositions;
        if (opts?.removeOpenKey && openPositions) {
          openPositions = openPositions.filter((p) => p.key !== opts.removeOpenKey);
        }
        const patch = opts?.openPositionPatch;
        if (patch && patch.capitalEur > 0) {
          const rest = (openPositions ?? []).filter((p) => p.key !== patch.key);
          openPositions = [
            ...rest,
            {
              key: patch.key,
              ticker: patch.ticker,
              capitalEur: patch.capitalEur,
              pnlEur: 0,
              pnlPct: 0,
              investedAt: savedAt,
              recAction: "hold",
            },
          ];
        }
        return {
          ...prev,
          investSimInputs: next,
          investSimInputsUpdatedAt: savedAt,
          ...(openPositions ? { openPositions } : {}),
        };
      });
      setMsg(note);
      void reloadOnly(
        (r) => {
          applyRefresh(r);
          // Defend against older snapshot book winning the merge race.
          setInputs((cur) => {
            const nextCap = openBookCapital(next);
            const loadedCap = openBookCapital(r.inputs);
            if (nextCap >= loadedCap) return unionOpenBooks(next, r.inputs);
            return preferLocalBookIfFresher(cur, savedAt, r.inputs, r.inputsUpdatedAt);
          });
          setInputsUpdatedAt((prev) => {
            const loaded = r.inputsUpdatedAt ? Date.parse(r.inputsUpdatedAt) : 0;
            const local = prev ? Date.parse(prev) : Date.parse(savedAt);
            return local >= loaded && prev ? prev : r.inputsUpdatedAt ?? savedAt;
          });
        },
        (m) => setErr(m),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      persistBusyRef.current = false;
      setBusy(false);
    }
  };

  const confirmRecTrade = (capitalEur: number) => {
    if (!recTrade) return;
    const { key, side, ticker } = recTrade;
    const target = resolveMobileTradeTarget(key, sheet, inputs);
    const canonKey = target.canonKey || key;
    if (side === "buy") {
      const priceUsd =
        (target.priceUsd != null && target.priceUsd > 0
          ? target.priceUsd
          : recTrade.priceUsd) ?? null;
      if (priceUsd == null || !(priceUsd > 0)) {
        setRecTradeErr(t("recTrade.err.noPrice"));
        return;
      }
      if (!Number.isFinite(capitalEur) || capitalEur <= 0) {
        setRecTradeErr(t("recTrade.err.invalidCapital"));
        return;
      }
      const next = {
        ...inputs,
        [canonKey]: mergeEntryForSave(inputs[canonKey] ?? inputs[key], priceUsd, capitalEur, false),
      };
      // Drop alias key if Soft list used a non-canonical CD form.
      if (key !== canonKey && next[key] && key.split("|")[0] === canonKey.split("|")[0]) {
        delete next[key];
      }
      setRecTrade(null);
      void persistInputs(
        next,
        t("recTrade.msg.bought", {
          ticker: target.ticker || ticker,
          eur: `€${Math.round(capitalEur).toLocaleString("en-US")}`,
          price: fmtUsd(priceUsd),
        }),
        {
          openPositionPatch: {
            key: canonKey,
            ticker: target.ticker || ticker,
            capitalEur: Math.round(capitalEur),
            buyPrice: priceUsd,
          },
        },
      );
      return;
    }
    const pos =
      target.pos ??
      posByKey.get(canonKey) ??
      posByKey.get(key) ??
      (target.row ? computeSimulationPosition(target.row, inputs) : null);
    if (!pos || !(pos.capital > 0)) {
      setRecTradeErr(t("recTrade.err.noPosition"));
      return;
    }
    const next = {
      ...inputs,
      [canonKey]: mergeEntryForSave(inputs[canonKey] ?? inputs[key], 0, 0, true, {
        capital: pos.capital,
        valueNow: pos.valueNow,
        pnlEur: pos.pnlEur,
      }),
    };
    if (key !== canonKey && next[key]) delete next[key];
    setRecTrade(null);
    void (async () => {
      await persistInputs(next, t("recTrade.msg.sold", { ticker: target.ticker || ticker }), {
        removeOpenKey: canonKey,
      });
      if (tester?.testerId && !pos.pnlUnavailable) {
        try {
          await postTesterFeedbackEvent({
            tester_id: tester.testerId,
            display_name: tester.displayName,
            module: "portfolio",
            kind: "gain_note",
            source: "mobile",
            ticker: pos.ticker,
            payload: {
              email: tester.email,
              action: "close",
              pnl_eur: Math.round(pos.pnlEur * 100) / 100,
              pnl_pct: Math.round(pos.pnlPct * 100) / 100,
              capital_eur: pos.capital,
              buy_price: pos.buyPrice,
              sell_price: pos.currPrice,
            },
          });
        } catch {
          /* non-blocking */
        }
      }
    })();
  };

  const openDetail = (key: string) => {
    setSelectedKey(key);
    setScreen("detail");
    setMsg(null);
    setErr(null);
  };

  const openOpportunity = (key: string) => {
    setSelectedKey(key);
    setScreen("opportunity");
    setMsg(null);
    setErr(null);
    setOppTradeErr(null);
  };

  const confirmOpportunityBuy = (capitalEur: number) => {
    if (!selectedKey) return;
    const target = resolveMobileTradeTarget(selectedKey, sheet, inputs);
    const ticker = target.ticker || selectedKey;
    const priceUsd = target.priceUsd;
    if (priceUsd == null || !(priceUsd > 0)) {
      setOppTradeErr(t("recTrade.err.noPrice"));
      return;
    }
    if (!Number.isFinite(capitalEur) || capitalEur <= 0) {
      setOppTradeErr(t("recTrade.err.invalidCapital"));
      return;
    }
    setOppTradeErr(null);
    const next = {
      ...inputs,
      [target.canonKey]: mergeEntryForSave(
        inputs[target.canonKey] ?? inputs[selectedKey],
        priceUsd,
        capitalEur,
        false,
      ),
    };
    void persistInputs(
      next,
      t("recTrade.msg.bought", {
        ticker,
        eur: `€${Math.round(capitalEur).toLocaleString("en-US")}`,
        price: fmtUsd(priceUsd),
      }),
      {
        openPositionPatch: {
          key: target.canonKey,
          ticker,
          capitalEur: Math.round(capitalEur),
          buyPrice: priceUsd,
        },
      },
    );
  };

  const confirmOpportunitySell = () => {
    if (!selectedKey) return;
    const target = resolveMobileTradeTarget(selectedKey, sheet, inputs);
    const ticker = target.ticker || selectedKey;
    const pos =
      target.pos ??
      selectedPos ??
      (target.row ? computeSimulationPosition(target.row, inputs) : null);
    if (!pos || !(pos.capital > 0)) {
      setOppTradeErr(t("recTrade.err.noPosition"));
      return;
    }
    setOppTradeErr(null);
    const next = {
      ...inputs,
      [target.canonKey]: mergeEntryForSave(inputs[target.canonKey] ?? inputs[selectedKey], 0, 0, true, {
        capital: pos.capital,
        valueNow: pos.valueNow,
        pnlEur: pos.pnlEur,
      }),
    };
    void (async () => {
      await persistInputs(next, t("recTrade.msg.sold", { ticker }), {
        removeOpenKey: target.canonKey,
      });
      if (tester?.testerId && !pos.pnlUnavailable) {
        try {
          await postTesterFeedbackEvent({
            tester_id: tester.testerId,
            display_name: tester.displayName,
            module: "portfolio",
            kind: "gain_note",
            source: "mobile",
            ticker: pos.ticker,
            payload: {
              email: tester.email,
              action: "close",
              pnl_eur: Math.round(pos.pnlEur * 100) / 100,
              pnl_pct: Math.round(pos.pnlPct * 100) / 100,
              capital_eur: pos.capital,
              buy_price: pos.buyPrice,
              sell_price: pos.currPrice,
            },
          });
        } catch {
          /* non-blocking */
        }
      }
    })();
  };

  const closeDetail = () => {
    setScreen("dashboard");
    setSelectedKey(null);
  };

  const saveDetail = () => {
    if (!selectedKey) return;
    const typedBuy = Number(detailBuy.replace(",", "."));
    const cap = Number(detailCap.replace(",", "."));
    if (!Number.isFinite(typedBuy) || typedBuy < 0 || !Number.isFinite(cap) || cap < 0) {
      setErr(t("error.invalidPriceCapital"));
      return;
    }
    const existing = inputs[selectedKey];
    const hadOpenPosition = !!existing && !existing.ignoreSheet && (existing.capital ?? 0) > 0;
    const marketOpen = getNasdaqStatus().open;
    const currPrice = selectedPos?.currPrice ?? null;
    let buy = typedBuy;
    let snapNote: string | null = null;
    if (!hadOpenPosition && !marketOpen && currPrice != null && currPrice > 0 && cap > 0) {
      const rel = typedBuy > 0 ? Math.abs(typedBuy - currPrice) / currPrice : 1;
      if (typedBuy <= 0 || rel > 0.001) {
        buy = currPrice;
        snapNote = t("detail.marketClosedSnapped", { price: `$${currPrice.toFixed(2)}` });
      }
    }
    const next = { ...inputs, [selectedKey]: mergeEntryForSave(inputs[selectedKey], buy, cap, false) };
    void persistInputs(next, snapNote ?? t("msg.saved"));
    if (snapNote) setDetailBuy(String(buy));
  };

  const closePosition = () => {
    if (!selectedKey || !selectedRow) return;
    const closedPos = selectedPos ?? computeSimulationPosition(selectedRow, inputs);
    const next = {
      ...inputs,
      [selectedKey]: mergeEntryForSave(
        inputs[selectedKey],
        0,
        0,
        true,
        closedPos && closedPos.capital > 0
          ? {
              capital: closedPos.capital,
              valueNow: closedPos.valueNow,
              pnlEur: closedPos.pnlEur,
            }
          : null,
      ),
    };
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

  const backLabel = t("nav.dashboard");

  if (!ready) {
    return (
      <div className="app-shell">
        <AppHeader subtitle={`v${MOBILE_APP_VERSION} · ${t("connection.subtitle")}`} theme={theme} onToggleTheme={toggleTheme} />
        <main className="app-main">
          <DevModeBanner text={t("dev.banner")} />
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
          <DevModeBanner text={t("dev.banner")} />
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

  const autoSoldOverlay = autoSoldPopup ? (
    <AutoSoldModal event={autoSoldPopup} onClose={dismissAutoSoldPopup} />
  ) : null;

  if (screen === "opportunity" && selectedRow && selectedKey) {
    return (
      <>
        {autoSoldOverlay}
        <div className="app-shell app-shell--opportunity">
          <OpportunityScreenNav
            backLabel={backLabel}
            onBack={closeDetail}
            onMenu={() => openDetail(selectedKey)}
          />
          <main className="app-main opportunity-detail-main">
            <OpportunityDetailView
              rowKey={selectedKey}
              row={selectedRow}
              sheet={sheet}
              inputs={inputs}
              dashSnapshot={dashSnapshot}
              clinicalRecordsMerged={clinicalRecordsMerged}
              chartBundle={chartBundle}
              enrichment={scoreEnrichment}
              startingCapital={startingCapital}
              tradeBusy={busy}
              tradeErr={oppTradeErr}
              onOpenSimEdit={() => openDetail(selectedKey)}
              onTradeBuy={confirmOpportunityBuy}
              onTradeSell={confirmOpportunitySell}
            />
          </main>
        </div>
      </>
    );
  }

  if (screen === "detail" && selectedRow && selectedKey) {
    return (
      <>
        {autoSoldOverlay}
        <div className="app-shell">
          <AppHeader
            title={selectedPos?.ticker ?? String(selectedRow.Ticker)}
            subtitle={`v${MOBILE_APP_VERSION}`}
            onBack={closeDetail}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
          <DetailScreen
            rowKey={selectedKey}
            row={selectedRow}
            sheet={sheet}
            inputs={inputs}
            dashSnapshot={dashSnapshot}
            enrichment={scoreEnrichment}
            startingCapital={startingCapital}
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
      </>
    );
  }

  return (
    <>
      {autoSoldOverlay}
    <div className="app-shell">
      <AppHeader
        tab="dashboard"
        subtitle={`${t("nav.dashboard")} · v${MOBILE_APP_VERSION}`}
        apiOk={apiOk}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="app-main">
        <DevModeBanner text={t("dev.banner")} />
        {err ? <p className="msg err">{err}</p> : null}
        {msg && screen === "dashboard" ? <p className="msg ok">{msg}</p> : null}

        <DashboardView
          sheet={sheet}
          inputs={inputs}
          dashSnapshot={dashSnapshot}
          enrichment={scoreEnrichment}
          chartBundle={chartBundle}
          refreshLoading={refreshLoading}
          lastUpdate={lastUpdate}
          theme={theme}
          onToggleTheme={toggleTheme}
          onRefresh={handleRefresh}
          onOpenDetail={(k) => openOpportunity(k)}
          onOpenRecTrade={openRecTrade}
          useTesterBook={Boolean(investBookTesterId)}
          linkedEmail={tester?.email ?? null}
        />
      </main>
      {recTrade ? (
        <RecTradeModal
          draft={recTrade}
          busy={busy}
          err={recTradeErr}
          onClose={() => {
            setRecTrade(null);
            setRecTradeErr(null);
          }}
          onConfirm={confirmRecTrade}
          onOpenDetail={() => {
            const k = recTrade.key;
            setRecTrade(null);
            setRecTradeErr(null);
            openOpportunity(k);
          }}
        />
      ) : null}
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
    </>
  );
}
