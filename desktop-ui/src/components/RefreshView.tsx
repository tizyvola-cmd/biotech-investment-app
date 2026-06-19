import { useCallback, useEffect, useState } from "react";
import {
  fetchWorkbookStatus,
  type OrchestratorRunSummary,
  type WorkbookStatus,
} from "../api/refresh";
import { fetchRefreshLog, fetchRefreshStatus } from "../api/supernova";
import { useLang, useT } from "../shared/i18n";
import {
  reopenSundayRefreshResult,
  useRefreshStatus,
} from "../shared/refreshStatusStore";

/** Profiles on the Refresh tab only. */
export const REFRESH_TAB_PROFILE_IDS = ["daily", "sunday"] as const;
export type RefreshTabProfileId = (typeof REFRESH_TAB_PROFILE_IDS)[number];

const DATA_SOURCES: { href: string; labelKey: "refreshView.sources.yahoo" | "refreshView.sources.sec" | "refreshView.sources.ctgov" | "refreshView.sources.fda" | "refreshView.sources.openfda" }[] = [
  { href: "https://finance.yahoo.com/", labelKey: "refreshView.sources.yahoo" },
  { href: "https://www.sec.gov/edgar/searchedgar/companysearch.html", labelKey: "refreshView.sources.sec" },
  { href: "https://clinicaltrials.gov/", labelKey: "refreshView.sources.ctgov" },
  { href: "https://www.fda.gov/drugs", labelKey: "refreshView.sources.fda" },
  { href: "https://open.fda.gov/", labelKey: "refreshView.sources.openfda" },
];

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function openExternal(href: string) {
  const open = window.supernova?.shell?.openExternal;
  if (open) void open(href);
  else window.open(href, "_blank", "noopener,noreferrer");
}

function RefreshRunSummary({
  wb,
  busy,
}: {
  wb: WorkbookStatus;
  busy: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const { life, lastSundayResult, lastSundayFinishedAt } = useRefreshStatus();
  const sum: OrchestratorRunSummary | null | undefined = wb.orchestrator_summary;
  const dailyMsg = wb.refresh_fast_status?.message;
  const dailyUpdated = wb.refresh_fast_status?.updated_at;
  const locale = lang === "it" ? "it-IT" : "en-US";

  const fullInFlight = busy && life.profile === "sunday";
  const dailyInFlight = busy && life.profile === "daily";

  return (
    <div className="text-sm rounded-lg border border-[rgb(var(--border))] bg-surface/50 p-3 space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
          {t("refreshView.summary.dailyLabel")}
        </p>
        {dailyInFlight ? (
          <p className="text-xs text-accent">{t("refreshView.summary.running")}</p>
        ) : dailyMsg ? (
          <p className="text-xs leading-snug text-ink-muted">{dailyMsg}</p>
        ) : (
          <p className="text-xs text-ink-muted/70">{t("refreshView.summary.noDaily")}</p>
        )}
        {dailyUpdated && !dailyInFlight ? (
          <p className="text-[10px] text-ink-muted/60 tabular-nums mt-1">
            {new Date(dailyUpdated).toLocaleString(locale)}
          </p>
        ) : null}
      </div>

      <div className="border-t border-[rgb(var(--border))]/40 pt-2">
        <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
          {t("refreshView.summary.fullLabel")}
        </p>
        {fullInFlight && life.profile === "sunday" ? (
          <p className="text-xs text-violet-300">{t("refreshView.summary.fullRunning")}</p>
        ) : lastSundayResult ? (
          <div className="space-y-1">
            <p
              className={`text-xs leading-snug ${
                lastSundayResult.success ? "text-positive" : "text-negative"
              }`}
            >
              {lastSundayResult.success
                ? t("refreshView.summary.fullOk", {
                    elapsed: fmtElapsed(lastSundayResult.elapsedSec),
                  })
                : t("refreshView.summary.fullErr")}
              {lastSundayResult.message ? ` — ${lastSundayResult.message}` : ""}
            </p>
            {lastSundayFinishedAt ? (
              <p className="text-[10px] text-ink-muted tabular-nums">
                {lastSundayFinishedAt.toLocaleString(locale)}
              </p>
            ) : null}
            <button
              type="button"
              className="btn-ghost text-[10px] px-2 py-0.5"
              onClick={() => reopenSundayRefreshResult()}
            >
              {t("refreshView.summary.reopenFull")}
            </button>
          </div>
        ) : sum?.finished_at_display || sum?.elapsed_sec != null ? (
          <p className="text-xs text-ink">
            {sum?.finished_at_display ? (
              <span className="font-medium tabular-nums">{sum.finished_at_display}</span>
            ) : null}
            {sum?.elapsed_sec != null ? (
              <span className="text-ink-muted">
                {" "}
                ·{" "}
                {t("refreshView.duration", {
                  min: String(Math.floor(sum.elapsed_sec / 60)),
                  sec: String(sum.elapsed_sec % 60),
                })}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-xs text-ink-muted/70">{t("refreshView.noFullSummary")}</p>
        )}
      </div>
    </div>
  );
}

export function RefreshView({
  apiOk,
  busy,
  onBusyChange,
  onBeforeRefreshStart,
  onStartProfile,
}: {
  apiOk: boolean | null;
  busy: boolean;
  onBusyChange: (b: boolean) => void;
  onBeforeRefreshStart?: () => void;
  onStartProfile: (id: RefreshTabProfileId) => Promise<void>;
}) {
  const t = useT();
  const [wb, setWb] = useState<WorkbookStatus | null>(null);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const w = await fetchWorkbookStatus();
      setWb(w);
      const st = await fetchRefreshStatus();
      if (st.running) onBusyChange(true);
      else onBusyChange(false);
      const lg = await fetchRefreshLog(8000);
      setLog(lg.log);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onBusyChange]);

  useEffect(() => {
    if (apiOk !== true) return;
    void refreshStatus();
  }, [apiOk, refreshStatus]);

  useEffect(() => {
    if (!busy || apiOk !== true) return;
    const id = window.setInterval(async () => {
      const lg = await fetchRefreshLog(8000);
      setLog(lg.log);
      void refreshStatus();
    }, 4000);
    return () => window.clearInterval(id);
  }, [busy, apiOk, refreshStatus]);

  const startProfile = async (id: RefreshTabProfileId) => {
    setError(null);
    onBeforeRefreshStart?.();
    setLog(t("refreshView.log.starting", { profile: id }));
    try {
      await onStartProfile(id);
      setLog((prev) => `${prev}\n${t("refreshView.log.started")}\n`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onBusyChange(false);
    }
  };

  const profileCards: {
    id: RefreshTabProfileId;
    titleKey: "refreshView.daily.title" | "refreshView.full.title";
    detailKey: "refreshView.daily.detail" | "refreshView.full.detail";
    etaKey: "refreshView.daily.eta" | "refreshView.full.eta";
    primary?: boolean;
    accent?: boolean;
  }[] = [
    {
      id: "daily",
      titleKey: "refreshView.daily.title",
      detailKey: "refreshView.daily.detail",
      etaKey: "refreshView.daily.eta",
      primary: true,
    },
    {
      id: "sunday",
      titleKey: "refreshView.full.title",
      detailKey: "refreshView.full.detail",
      etaKey: "refreshView.full.eta",
      accent: true,
    },
  ];

  if (apiOk === false) {
    return (
      <section className="card p-6 max-w-2xl">
        <h2 className="text-lg font-semibold">{t("refreshView.title")}</h2>
        <p className="text-sm text-negative mt-2">{t("refreshView.apiOffline")}</p>
      </section>
    );
  }

  return (
    <section className="card refresh-view-panel p-5 flex flex-col gap-4 max-w-3xl flex-1 min-h-0">
      <div>
        <h2 className="text-lg font-semibold">{t("refreshView.title")}</h2>
        <p className="text-sm text-ink-muted mt-1">{t("refreshView.subtitle")}</p>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-2">
          {t("refreshView.sources.title")}
        </p>
        <div className="flex flex-wrap gap-2">
          {DATA_SOURCES.map(({ href, labelKey }) => (
            <button
              key={href}
              type="button"
              className="btn-ghost text-xs"
              onClick={() => openExternal(href)}
            >
              {t(labelKey)}
            </button>
          ))}
          <button type="button" className="btn-ghost text-xs ml-auto" onClick={() => void refreshStatus()}>
            {t("refreshView.refreshStatus")}
          </button>
        </div>
      </div>

      {wb ? <RefreshRunSummary wb={wb} busy={busy} /> : null}

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {profileCards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`text-left rounded-xl border px-4 py-4 transition disabled:opacity-50 ${
              card.accent
                ? "border-violet-500/45 bg-violet-500/8 hover:bg-violet-500/12 hover:border-violet-500/60"
                : card.primary
                  ? "border-accent/60 bg-accent/10 hover:bg-accent/15 hover:border-accent"
                  : "border-[rgb(var(--border))] hover:border-accent/40 hover:bg-accent/5"
            }`}
            disabled={busy}
            onClick={() => void startProfile(card.id)}
          >
            <div className="font-semibold text-base text-ink">{t(card.titleKey)}</div>
            <div className="text-xs text-ink-muted mt-2 leading-snug">{t(card.detailKey)}</div>
            <div
              className={`text-xs font-medium mt-2 tabular-nums ${
                card.accent ? "text-violet-300" : card.primary ? "text-accent" : "text-ink-muted"
              }`}
            >
              {t(card.etaKey)}
            </div>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-[12rem] flex flex-col">
        <h3 className="text-sm font-medium mb-2">{t("refreshView.logTitle")}</h3>
        <pre className="flex-1 overflow-auto rounded-lg bg-surface p-3 text-xs text-ink-muted whitespace-pre-wrap">
          {log || (busy ? t("refreshView.log.running") : t("refreshView.log.empty"))}
        </pre>
      </div>
    </section>
  );
}
