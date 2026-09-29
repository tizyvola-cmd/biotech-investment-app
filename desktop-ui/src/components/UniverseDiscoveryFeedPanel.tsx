import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchCatalystCalendarSnapshot,
  fetchFdaAdcomCalendarSnapshot,
  fetchGuidanceCalendarSnapshot,
  fetchUniverseDiscoverySnapshot,
  fetchUniverseDiscoveryStatus,
  hasStoredApiToken,
  reviewUniverseDiscoveryCandidate,
  runUniverseDiscoveryRefresh,
  type CatalystCalendarEntry,
  type DiscoveryCandidate,
  type FdaAdcomCalendarRow,
  type GuidanceCalendarEvent,
  type UniverseDiscoverySnapshot,
  type UniverseDiscoveryStatus,
} from "../api/supernova";
import { formatDeskEventDate } from "../sheet/deskCalendarEvents";
import { daysUntilIso } from "../sheet/nextCatalystEvent";
import {
  findScrollableParent,
  offsetInScrollContent,
} from "../sheet/scrollInContainer";
import {
  useVirtualTableBody,
  VirtualTablePadRow,
} from "../sheet/useVirtualTableBody";
import { DeskPageScroll } from "./DeskPageScroll";
import { TickerCompanyStack } from "./TickerCompanyStack";

const DISCOVERY_COL_SPAN = 8;
const DISCOVERY_VIRTUALIZE_AT = 20;

/** One upcoming catalyst chip for Discovery (8-K / FDA site / ClinicalTrials.gov). */
export type DiscoveryCatalystDay = {
  key: string;
  sort: string;
  whenLabel: string;
  typeLabel: string;
  /** Short badge: 8-K · FDA · CT.gov */
  source: "8-K" | "FDA" | "CT.gov" | "SEC";
  href?: string | null;
};

function normalizeTk(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase();
}

function classifySourceFromUrlAndType(
  href: string | null | undefined,
  sourceType: string | null | undefined,
): DiscoveryCatalystDay["source"] {
  const u = String(href || "").toLowerCase();
  const st = String(sourceType || "").toLowerCase();
  if (
    u.includes("clinicaltrials.gov") ||
    st.includes("clinicaltrials") ||
    st.includes("ctgov") ||
    st === "clinical"
  ) {
    return "CT.gov";
  }
  if (
    u.includes("fda.gov") ||
    st.includes("fda") ||
    st.includes("pdufa") ||
    st.includes("adcom")
  ) {
    return "FDA";
  }
  if (
    u.includes("sec.gov") ||
    st.includes("sec_8k") ||
    st.includes("8-k") ||
    st.includes("8k") ||
    st.includes("sec_10")
  ) {
    return st.includes("10") ? "SEC" : "8-K";
  }
  if (st.includes("sec")) return "SEC";
  return "SEC";
}

function guidanceTypeLabel(ev: GuidanceCalendarEvent, it: boolean): string {
  const raw = String(ev.event_type || "other").toLowerCase();
  const asset = (ev.asset_name || "").trim();
  const base =
    raw === "cd"
      ? "CD"
      : raw === "pdufa"
        ? "PDUFA"
        : raw === "readout"
          ? it
            ? "Readout"
            : "Readout"
          : raw === "fda_vote"
            ? "AdCom"
            : raw === "fda_safety"
              ? it
                ? "FDA safety"
                : "FDA safety"
              : raw === "submission"
                ? it
                  ? "Submission"
                  : "Submission"
                : raw === "approval"
                  ? it
                    ? "Approval"
                    : "Approval"
                  : raw === "initiation"
                    ? it
                      ? "Initiation"
                      : "Initiation"
                    : raw || "event";
  return asset ? `${base} · ${asset.slice(0, 28)}` : base;
}

function buildCatalystDaysByTicker(
  secEntries: CatalystCalendarEntry[] | undefined,
  fdaRows: FdaAdcomCalendarRow[] | undefined,
  guidanceEvents: GuidanceCalendarEvent[] | undefined,
  it: boolean,
): Map<string, DiscoveryCatalystDay[]> {
  const map = new Map<string, DiscoveryCatalystDay[]>();
  const push = (tk: string, day: DiscoveryCatalystDay) => {
    if (!tk) return;
    // Keep upcoming (+ a few days past for just-passed meetings).
    const days = /^20\d{2}-\d{2}-\d{2}/.test(day.sort)
      ? daysUntilIso(day.sort.slice(0, 10))
      : null;
    if (days != null && days < -7) return;
    const list = map.get(tk) ?? [];
    if (list.some((x) => x.key === day.key)) return;
    // Prefer entries that already have a real href when deduping by date+type.
    const softKey = `${day.source}|${day.typeLabel.split(" · ")[0]}|${day.sort}`;
    const dupIdx = list.findIndex(
      (x) => `${x.source}|${x.typeLabel.split(" · ")[0]}|${x.sort}` === softKey,
    );
    if (dupIdx >= 0) {
      if (!list[dupIdx]!.href && day.href) list[dupIdx] = day;
      return;
    }
    list.push(day);
    map.set(tk, list);
  };

  // 1) SEC forward calendar (8-K / 10-Q extracts) — link to the filing.
  for (const e of secEntries ?? []) {
    const tk = normalizeTk(e.ticker);
    if (!tk) continue;
    const exact = (e.date_value || "").trim().slice(0, 10);
    const window = (e.window_label || "").trim();
    const when = exact || window;
    if (!when) continue;
    const form = String(e.source_form || "").toUpperCase();
    const source: DiscoveryCatalystDay["source"] =
      form.includes("8-K") || form.includes("8K") ? "8-K" : "SEC";
    const typeLabel = String(e.event_type || "event").trim() || "event";
    const whenLabel = exact ? formatDeskEventDate(exact) : window;
    const href = (e.source_filing_url || "").trim() || null;
    push(tk, {
      key: `sec|${tk}|${typeLabel}|${when}|${href || ""}`,
      sort: exact || `9999-${window}`,
      whenLabel,
      typeLabel,
      source,
      href,
    });
  }

  // 2) FDA Advisory Committee calendar — link to FDA meeting page.
  for (const r of fdaRows ?? []) {
    const tk = normalizeTk(r.ticker);
    if (!tk) continue;
    const exact = (r.date || "").trim().slice(0, 10);
    if (!exact) continue;
    const kind = String(r.kind || "vote").toLowerCase();
    const typeLabel = kind === "safety_review" ? "FDA safety" : "FDA AdCom";
    const href = (r.href || "").trim() || null;
    push(tk, {
      key: `fda|${tk}|${typeLabel}|${exact}`,
      sort: exact,
      whenLabel: formatDeskEventDate(exact),
      typeLabel,
      source: "FDA",
      href,
    });
  }

  // 3) Guidance / Calendar merge — CT.gov CD, PDUFA, 8-K LLM extracts, etc.
  for (const ev of guidanceEvents ?? []) {
    const tk = normalizeTk(ev.ticker);
    if (!tk) continue;
    const start = (ev.window_start || "").trim().slice(0, 10);
    const end = (ev.window_end || "").trim().slice(0, 10);
    const exact = start || end;
    if (!exact) continue;
    const href = (ev.link || "").trim() || null;
    const source = classifySourceFromUrlAndType(href, ev.source_type);
    const typeLabel = guidanceTypeLabel(ev, it);
    const whenLabel =
      start && end && start !== end
        ? `${formatDeskEventDate(start)}–${formatDeskEventDate(end)}`
        : formatDeskEventDate(exact);
    push(tk, {
      key: `g|${tk}|${ev.event_type || "e"}|${exact}|${href || ev.source_type || ""}`,
      sort: exact,
      whenLabel,
      typeLabel,
      source,
      href,
    });
  }

  for (const [tk, list] of map) {
    list.sort(
      (a, b) => a.sort.localeCompare(b.sort) || a.typeLabel.localeCompare(b.typeLabel),
    );
    map.set(tk, list);
  }
  return map;
}

function CatalystDaysCell({
  days,
  it,
}: {
  days: DiscoveryCatalystDay[];
  it: boolean;
}) {
  if (!days.length) {
    return (
      <span
        className="text-[10px] text-ink-muted"
        title={
          it
            ? "Nessun catalyst day ancora da 8-K / FDA / ClinicalTrials.gov — in attesa dello scan Calendar"
            : "No catalyst day yet from 8-K / FDA / ClinicalTrials.gov — waiting on Calendar scan"
        }
      >
        —
      </span>
    );
  }
  return (
    <ul className="mx-auto flex flex-col items-center gap-0.5 max-w-full">
      {days.map((d) => {
        const line = `${d.whenLabel} · ${d.typeLabel}`;
        const tip = d.href
          ? it
            ? `${d.source}: ${d.typeLabel} · ${d.whenLabel} — apri la fonte`
            : `${d.source}: ${d.typeLabel} · ${d.whenLabel} — open source`
          : `${d.source}: ${d.typeLabel} · ${d.whenLabel}`;
        const cls =
          "text-[10px] font-medium leading-snug text-ink hover:underline tabular-nums truncate max-w-full";
        return (
          <li key={d.key} className="min-w-0 max-w-full text-center">
            {d.href ? (
              <a
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className={cls}
                title={tip}
              >
                <span className="text-ink-muted font-semibold mr-1">{d.source}</span>
                {line}
              </a>
            ) : (
              <span className={`${cls} text-ink-muted`} title={tip}>
                <span className="font-semibold mr-1">{d.source}</span>
                {line}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TierBadge({ tier, it }: { tier?: string | null; it: boolean }) {
  const isA = (tier || "").toUpperCase() === "A";
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wide text-white ${
        isA
          ? "bg-[#22c55e] border-[#4ade80]"
          : "bg-[#d97706] border-[#fbbf24]"
      }`}
      title={
        isA
          ? it
            ? "Livello A — designazione precoce (BTD/Fast Track/…)"
            : "Tier A — early designation (BTD/Fast Track/…)"
          : it
            ? "Livello B — evento tardivo (PDUFA/topline/…)"
            : "Tier B — late event (PDUFA/topline/…)"
      }
    >
      {isA ? (it ? "A · early" : "A · early") : it ? "B · late" : "B · late"}
    </span>
  );
}

function KeywordChips({ keywords }: { keywords?: string[] }) {
  const list = keywords ?? [];
  if (!list.length) return <span className="text-ink-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-center">
      {list.map((k) => (
        <span
          key={k}
          className="inline-block px-1.5 py-0.5 rounded bg-surface text-[9px] font-medium text-ink border border-[rgb(var(--border))]/50"
        >
          {k}
        </span>
      ))}
    </div>
  );
}

export function UniverseDiscoveryFeedPanel({
  it = false,
}: {
  it?: boolean;
}) {
  const [snap, setSnap] = useState<UniverseDiscoverySnapshot | null>(null);
  const [status, setStatus] = useState<UniverseDiscoveryStatus | null>(null);
  const [catalystByTicker, setCatalystByTicker] = useState<
    Map<string, DiscoveryCatalystDay[]>
  >(() => new Map());
  const [filterTier, setFilterTier] = useState<"" | "A" | "B">("");
  const [filterText, setFilterText] = useState("");
  const [hideRejected, setHideRejected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, st, sec, fda, guidance] = await Promise.all([
        fetchUniverseDiscoverySnapshot(),
        fetchUniverseDiscoveryStatus(),
        fetchCatalystCalendarSnapshot().catch(() => null),
        fetchFdaAdcomCalendarSnapshot().catch(() => null),
        fetchGuidanceCalendarSnapshot().catch(() => null),
      ]);
      setSnap(s);
      setStatus(st);
      setCatalystByTicker(
        buildCatalystDaysByTicker(sec?.entries, fda?.rows, guidance?.events, it),
      );
    } catch {
      /* ignore */
    }
  }, [it]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status?.running) return;
    const id = window.setInterval(() => {
      void (async () => {
        const st = await fetchUniverseDiscoveryStatus().catch(() => null);
        if (st) setStatus(st);
        if (st && !st.running) void load();
      })();
    }, 2500);
    return () => window.clearInterval(id);
  }, [status?.running, load]);

  const candidates = useMemo(() => {
    const all = snap?.candidates ?? [];
    const q = filterText.trim().toUpperCase();
    return all.filter((c) => {
      const st = (c.status || "new").toLowerCase();
      if (hideRejected && st === "reviewed_rejected") return false;
      if (filterTier && String(c.signal_tier || "").toUpperCase() !== filterTier) return false;
      if (q) {
        const blob = `${c.ticker || ""} ${c.company_name || ""} ${c.cik || ""}`.toUpperCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [snap?.candidates, filterTier, filterText, hideRejected]);

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const wrap = tableScrollRef.current;
    if (!wrap) {
      setScrollEl(null);
      return;
    }
    const page =
      (wrap.closest(".desk-page-scroll") as HTMLElement | null) ??
      findScrollableParent(wrap);
    setScrollEl(page ?? wrap);
  }, [candidates.length]);

  useLayoutEffect(() => {
    const wrap = tableScrollRef.current;
    const scroll = scrollEl;
    if (!wrap || !scroll) {
      setScrollMargin(0);
      return;
    }
    const measure = () => {
      setScrollMargin(
        Math.max(0, Math.round(offsetInScrollContent(wrap, scroll))),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    if (wrap.parentElement) ro.observe(wrap.parentElement);
    ro.observe(scroll);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [scrollEl, candidates.length]);

  const virtualize = candidates.length > DISCOVERY_VIRTUALIZE_AT;
  const tableVirtual = useVirtualTableBody({
    count: candidates.length,
    scrollElement: scrollEl,
    estimateSize: 72,
    overscan: 10,
    scrollMargin,
    enabled: virtualize && Boolean(scrollEl),
  });
  const rowsToRender = useMemo(() => {
    if (!virtualize || !scrollEl || tableVirtual.virtualRows.length === 0) {
      return candidates.map((row, index) => ({ row, index }));
    }
    return tableVirtual.virtualRows.map((vr) => ({
      row: candidates[vr.index]!,
      index: vr.index,
    }));
  }, [virtualize, scrollEl, tableVirtual.virtualRows, candidates]);
  const measureRow = useCallback(
    (node: HTMLTableRowElement | null) => {
      if (node && virtualize) tableVirtual.virtualizer.measureElement(node);
    },
    [virtualize, tableVirtual.virtualizer],
  );

  const handleRefresh = async () => {
    setBusy(true);
    setNotice(null);
    if (!hasStoredApiToken()) {
      setNotice(
        it
          ? "Manca il token API (ingranaggio → API). Senza token il refresh Discovery non parte sul VPS."
          : "API token missing (gear → API). Discovery refresh needs it on the VPS.",
      );
      setBusy(false);
      return;
    }
    try {
      await runUniverseDiscoveryRefresh();
      const st = await fetchUniverseDiscoveryStatus();
      setStatus(st);
      if (!st?.running) void load();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err ?? "");
      const authFail =
        /missing or invalid api token/i.test(raw) || /\b401\b/.test(raw);
      setNotice(
        authFail
          ? it
            ? "Token API non valido — aggiornalo in Impostazioni (ingranaggio → API)."
            : "Invalid API token — update it in Settings (gear → API)."
          : it
            ? `Refresh non avviato: ${raw.slice(0, 160) || "errore sconosciuto"}`
            : `Could not start refresh: ${raw.slice(0, 160) || "unknown error"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReview = async (
    c: DiscoveryCandidate,
    next: "reviewed_added" | "reviewed_rejected",
  ) => {
    setRowBusy(c.cik);
    setNotice(null);
    try {
      const res = await reviewUniverseDiscoveryCandidate(c.cik, next, {
        startCalendar: false,
      });
      if (!res?.ok) {
        setNotice(res?.error || (it ? "Review fallita." : "Review failed."));
        return;
      }
      setSnap((prev) => {
        if (!prev) return prev;
        const list = (prev.candidates || []).map((row) =>
          row.cik === c.cik ? { ...row, status: next } : row,
        );
        return { ...prev, candidates: list };
      });
      if (next === "reviewed_rejected") {
        setNotice(
          it
            ? `${c.ticker || c.cik}: scartato — fuori dalla coda Calendar.`
            : `${c.ticker || c.cik}: rejected — removed from Calendar queue.`,
        );
      }
    } catch {
      setNotice(it ? "Errore di rete sul review." : "Network error on review.");
    } finally {
      setRowBusy(null);
    }
  };

  const meta = snap?.meta;
  const tierA = (snap?.candidates || []).filter((c) => c.signal_tier === "A").length;
  const tierB = (snap?.candidates || []).filter((c) => c.signal_tier !== "A").length;
  const autoQueued = Number((snap?.meta as { auto_queued_to_calendar?: number } | undefined)?.auto_queued_to_calendar ?? 0);

  const shell = (
    <div className="flex flex-col gap-3 min-w-0 w-full">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-ink">
            {it ? "Discovery Feed" : "Discovery Feed"}
          </h1>
          <p className="text-[10px] text-ink-muted max-w-prose mt-0.5 leading-snug">
            {it
              ? "I hit entrano automaticamente in Calendar (scan PDUFA/AdCom/Readout/Conference). 🔖 sulle nuove in Calendar. Scarta = fuori dalla coda. ≤60g (~2 mesi) → Wind / Catalyst / Eval Lab. Scan server: 2° del mese 07:30."
              : "Hits auto-enter Calendar (PDUFA/AdCom/Readout/Conference scan). 🔖 on new Calendar names. Reject = leave the queue. ≤60d (~2 mo) → Wind / Catalyst / Eval Lab. Server scan: 2nd of month 07:30."}
          </p>
          <p className="text-[9px] text-ink-muted mt-1">
            {snap?.updated_at
              ? `${it ? "Aggiornato" : "Updated"} ${snap.updated_at.slice(0, 19).replace("T", " ")} · ${
                  it ? "finestra" : "window"
                } ${snap.window_start ?? "?"} → ${snap.window_end ?? "?"} · ${
                  it ? "nuovi" : "new"
                } A=${tierA} B=${tierB}${
                  autoQueued ? ` · →Calendar ${autoQueued}` : ""
                }${
                  meta?.sics_param_effective != null
                    ? ` · SIC server=${meta.sics_param_effective ? "yes" : "no"}`
                    : ""
                }`
              : it
                ? "Nessuno snapshot — avvia Refresh."
                : "No snapshot yet — run Refresh."}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary text-[11px] px-2.5 py-1.5 shrink-0"
          disabled={busy || !!status?.running}
          onClick={() => void handleRefresh()}
        >
          {status?.running || busy
            ? status?.message || (it ? "Ricerca EDGAR…" : "EDGAR search…")
            : it
              ? "Refresh discovery"
              : "Refresh discovery"}
        </button>
      </header>

      {notice ? (
        <p className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="feed-panel-input rounded-lg px-2 py-1 text-[11px] w-36"
          placeholder={it ? "Ticker / nome…" : "Ticker / name…"}
          value={filterText}
          onChange={(e) => {
            const v = e.target.value;
            startTransition(() => setFilterText(v));
          }}
        />
        <select
          className="feed-panel-input rounded-lg px-2 py-1 text-[11px]"
          value={filterTier}
          onChange={(e) =>
            startTransition(() => setFilterTier(e.target.value as "" | "A" | "B"))
          }
        >
          <option value="">{it ? "Tutti i livelli" : "All tiers"}</option>
          <option value="A">{it ? "A — early" : "A — early"}</option>
          <option value="B">{it ? "B — late" : "B — late"}</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideRejected}
            onChange={(e) => {
              const v = e.target.checked;
              startTransition(() => setHideRejected(v));
            }}
          />
          {it ? "Nascondi scartati" : "Hide rejected"}
        </label>
        <span className="text-[10px] text-ink-muted ml-auto">
          {candidates.length} {it ? "visibili" : "visible"}
        </span>
      </div>

      <div
        ref={tableScrollRef}
        className="min-w-0 w-full rounded-lg border border-[rgb(var(--border))]/40"
        data-virtual-discovery={virtualize ? "1" : "0"}
      >
        <table className="w-full min-w-[56rem] table-fixed text-[11px] border-collapse">
          <colgroup>
            {/* Seen + Ticker compact; remaining 6 columns equal share */}
            <col style={{ width: "8%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead className="sticky top-0 z-[2] bg-[rgb(var(--surface))] text-ink-muted shadow-[0_1px_0_rgb(var(--border)/0.55)]">
            <tr>
              <th className="px-1.5 py-1.5 font-semibold text-left">
                {it ? "Visto" : "Seen"}
              </th>
              <th className="px-1.5 py-1.5 font-semibold text-left">Ticker</th>
              <th
                className="px-1.5 py-1.5 font-semibold text-center"
                title={
                  it
                    ? "Prossimi catalyst: 8-K / SEC, sito FDA, ClinicalTrials.gov — clic apre la pagina fonte"
                    : "Upcoming catalysts: 8-K / SEC, FDA site, ClinicalTrials.gov — click opens the source page"
                }
              >
                Catalyst
              </th>
              <th className="px-1.5 py-1.5 font-semibold text-center">Tier</th>
              <th className="px-1.5 py-1.5 font-semibold text-center">Keywords</th>
              <th className="px-1.5 py-1.5 font-semibold text-center">SIC</th>
              <th className="px-1.5 py-1.5 font-semibold text-center">Filing</th>
              <th className="px-1.5 py-1.5 font-semibold text-center">
                {it ? "Azioni" : "Actions"}
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan={DISCOVERY_COL_SPAN} className="px-3 py-8 text-center text-ink-muted text-[11px]">
                  {it
                    ? "Nessun candidato nuovo in questa finestra."
                    : "No new candidates in this window."}
                </td>
              </tr>
            ) : (
              <>
                {virtualize && scrollEl ? (
                  <VirtualTablePadRow
                    height={tableVirtual.paddingTop}
                    colSpan={DISCOVERY_COL_SPAN}
                  />
                ) : null}
                {rowsToRender.map(({ row: c, index }) => {
                const st = (c.status || "new").toLowerCase();
                const inCalendar = st === "reviewed_added" || st === "new";
                const tk = normalizeTk(c.ticker);
                const catDays = tk ? catalystByTicker.get(tk) ?? [] : [];
                return (
                  <tr
                    key={c.cik}
                    data-index={index}
                    ref={measureRow}
                    className="border-t border-[rgb(var(--border))]/30 hover:bg-[rgb(var(--panel-feed-row-hover))]/40"
                  >
                    <td className="px-1.5 py-1.5 whitespace-nowrap align-middle text-left tabular-nums">
                      {c.first_seen_at || "—"}
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-left overflow-hidden">
                      <TickerCompanyStack
                        ticker={c.ticker || "—"}
                        company={c.company_name}
                        companyClassName="text-[9px] text-ink-muted truncate max-w-full leading-snug mt-0.5"
                        tickerNode={
                          <span className="font-semibold whitespace-nowrap">
                            {c.ticker || "—"}
                          </span>
                        }
                      />
                      <div className="text-[9px] text-ink-muted mt-0.5 truncate">
                        CIK {c.cik}
                      </div>
                      {c.raw_snippet && c.raw_snippet.length > 8 ? (
                        <div
                          className="text-[9px] text-ink-muted mt-0.5 line-clamp-2 break-words"
                          title={c.raw_snippet}
                        >
                          {c.raw_snippet}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-center overflow-hidden">
                      <CatalystDaysCell days={catDays} it={it} />
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-center">
                      <div className="inline-flex flex-col items-center gap-0.5">
                        <TierBadge tier={c.signal_tier} it={it} />
                        <div className="text-[9px] font-semibold text-white">
                          {st === "reviewed_added"
                            ? it
                              ? "in Calendar"
                              : "in Calendar"
                            : st === "reviewed_rejected"
                              ? it
                                ? "scartato"
                                : "rejected"
                              : it
                                ? "in coda"
                                : "queued"}
                        </div>
                      </div>
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-center overflow-hidden">
                      <KeywordChips keywords={c.matched_keywords} />
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-center whitespace-nowrap tabular-nums">
                      {c.sic_code || "—"}
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-center">
                      {c.source_filing_url ? (
                        <a
                          href={c.source_filing_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          8-K
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-center whitespace-nowrap">
                      {inCalendar ? (
                        <button
                          type="button"
                          className="rounded-lg border border-[rgb(var(--border))]/60 px-2 py-1 text-[10px] text-ink-muted hover:bg-surface"
                          disabled={rowBusy === c.cik}
                          title={
                            it
                              ? "Togli dalla coda Calendar"
                              : "Remove from Calendar queue"
                          }
                          onClick={() => void handleReview(c, "reviewed_rejected")}
                        >
                          {it ? "Scarta" : "Reject"}
                        </button>
                      ) : (
                        <span className="text-[10px] text-ink-muted">
                          {it ? "scartato" : "rejected"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
                {virtualize && scrollEl ? (
                  <VirtualTablePadRow
                    height={tableVirtual.paddingBottom}
                    colSpan={DISCOVERY_COL_SPAN}
                  />
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <DeskPageScroll data-page="discovery" className="p-3 sm:p-4">
      {shell}
    </DeskPageScroll>
  );
}
