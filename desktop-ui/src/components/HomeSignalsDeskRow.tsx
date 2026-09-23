/**
 * One Catalyst Days table row — React.memo + per-key live store subscriptions
 * so a sibling ticker update does not re-render this row.
 */
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { eventVolPairKey, type ClinicalPreCdRecord } from "../api/supernova";
import type { FdaAdcomRow } from "../sheet/fdaAdcomCalendar";
import { FdaBriefingCell } from "./FdaAdcomBriefingModal";
import {
  eventVolHasPrint,
  formatIvrCell,
  formatSkewCell,
  resolveEventVolRow,
} from "../sheet/eventVolIndexDisplay";
import {
  deskStaleProvenanceTip,
  deskStaleSessionBadge,
  deskRowIsStaleCarry,
} from "../sheet/deskFieldProvenance";
import { formatShortInterestCell } from "../sheet/catalystShortInterestDisplay";
import {
  formatSilentMoneyCell,
  formatGovFlagCell,
} from "../sheet/catalystAccumulationDisplay";
import {
  formatBiasCell,
  priceVolKindFromLabel,
} from "../sheet/catalystBiasDisplay";
import { formatVsXbiCell } from "../sheet/catalystVsXbiDisplay";
import {
  applySearchBuzzConfirm,
  formatPreMktConvictionCell,
} from "../sheet/preMktConvictionDisplay";
import {
  deskIndexTextClass,
  deskLiveOrStaleTone,
  deskSignedLiveTone,
  toDeskIndexTone,
  type DeskIndexTone,
} from "../sheet/deskIndexTone";
import {
  deskVolumeQtyTooltip,
  fillDeskSessionPriceFromSim,
  formatDeskVolumeQtyOnly,
  formatPriceVolDivergence,
  resolveDeskDelta24hPct,
} from "../sheet/volumeVsPrevSession";
import {
  currentPriceFromRow,
  dailyChangePctFromRow,
} from "../sheet/simulationPosition";
import { formatSignedPct } from "../sheet/expectedRoiDisplay";
import {
  deskEventTypeShort,
  formatDeskEventDays,
  type DeskCalendarEvent,
} from "../sheet/deskCalendarEvents";
import {
  formatSearchInterestCell,
  searchInterestDeltaPct,
  searchInterestTooltip,
} from "../sheet/searchInterestDisplay";
import { companyNameFromSimRow } from "../sheet/tickerCompanyLabel";
import { eventReferenceDoc } from "../sheet/deskReferenceExplain";
import { TickerCompanyStack } from "./TickerCompanyStack";
import { AttentionStarToggle } from "./AttentionStarToggle";
import { StudyTypeTickerIcon, STUDY_DRUG_ICON_PX } from "./StudyTypeTickerIcon";
import { NewsDimensionScoreCell } from "./NewsDimensionScoreCell";
import type { NewsDimensionScores } from "../sheet/newsDimensionScores";
import {
  isDebugRendersEnabled,
  useDebugRenderCount,
  formatDebugRenderBadge,
} from "../sheet/debugRenderCount";
import { useKeyedMapEntry, useKeyedMapVersion } from "../sheet/keyedMapStore";
import type { DeskLiveStores } from "../sheet/deskLiveStores";
import { tickerRowShallowEqual } from "../sheet/catalystDeskColumnCache";

const DESK_CELL =
  "px-0.5 py-0.5 align-middle text-center border-b border-[rgb(var(--border))]/25 overflow-hidden max-w-0";
const DESK_CELL_LEFT =
  "px-0.5 py-0.5 align-middle text-left border-b border-[rgb(var(--border))]/25 overflow-hidden max-w-0";
const DESK_CHIP_CELL = DESK_CELL;

function DeskIndexText({
  tone,
  title,
  children,
}: {
  tone: DeskIndexTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full flex-col items-center leading-tight ${deskIndexTextClass(tone)}`}
    >
      {children}
    </span>
  );
}

export type HomeSignalsDeskRowProps = {
  row: DeskCalendarEvent;
  /** Virtual list index — for measureElement / data-index. */
  virtualIndex?: number;
  measureElement?: (node: HTMLTableRowElement | null) => void;
  it: boolean;
  liveSession: boolean;
  simRow: Record<string, unknown> | undefined;
  companyFallback: string | null;
  /** Product / candidate name (stacked above designation). */
  productLabel?: string;
  /** FDA designations under the product name. */
  designationLabel?: string;
  /** Daily News taxonomy scores (EIS + Clin/Fin/…). */
  newsScores?: NewsDimensionScores | null;
  /** Stable store bag — identity never changes for the desk instance. */
  live: DeskLiveStores;
  priorSessionPct: number | null;
  fdaHit: FdaAdcomRow | null;
  isNewToday: boolean;
  trendsLoading: boolean;
  eventVolLoading: boolean;
  shortInterestLoading: boolean;
  accumLoading: boolean;
  vsXbiLoading: boolean;
  preMktLoading: boolean;
  onOpenTopKpi: (ticker: string, rowKey?: string) => void;
  onOpenEventRef: (
    doc: ReturnType<typeof eventReferenceDoc>,
  ) => void;
  onOpenBriefing: (row: FdaAdcomRow) => void;
  /** Product cell → modality / MoA / target modal. */
  onOpenProduct?: () => void;
  /** Optional clinical pre-CD — used when opening the Catalyst Event modal. */
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  /** Owner-admin only: Soft BUY/SELL/HOLD column. */
  showRecCol?: boolean;
  recLabel?: string;
  recToneClass?: string;
  recTitle?: string;
};

function HomeSignalsDeskRowImpl({
  row,
  virtualIndex,
  measureElement,
  it,
  liveSession,
  simRow,
  companyFallback,
  productLabel = "",
  designationLabel = "",
  newsScores = null,
  live,
  priorSessionPct,
  fdaHit,
  isNewToday,
  trendsLoading,
  eventVolLoading,
  shortInterestLoading,
  accumLoading,
  vsXbiLoading,
  preMktLoading,
  onOpenTopKpi,
  onOpenEventRef,
  onOpenBriefing,
  onOpenProduct,
  clinicalRecords = null,
  showRecCol = false,
  recLabel = "—",
  recToneClass = "text-ink-muted font-normal",
  recTitle,
}: HomeSignalsDeskRowProps) {
  const debugRenders = isDebugRendersEnabled();
  const renderN = useDebugRenderCount(debugRenders, row.key);

  const vol = useKeyedMapEntry(live.vol, row.ticker);
  const trend = useKeyedMapEntry(live.trend, row.ticker);
  const eventVolKey = eventVolPairKey(row.ticker, row.eventDate);
  const eventVolExact = useKeyedMapEntry(live.eventVol, eventVolKey);
  const eventVolVersion = useKeyedMapVersion(live.eventVol);
  // Exact pair first; else nearest dated print for the same ticker (Friday cache
  // often keys a slightly different catalyst date than today's desk row).
  const eventVol = useMemo(() => {
    if (eventVolHasPrint(eventVolExact)) return eventVolExact;
    const resolved = resolveEventVolRow(
      live.eventVol.peekAll(),
      row.ticker,
      row.eventDate,
    );
    return resolved ?? eventVolExact;
    // eventVolVersion: re-resolve when sibling pair keys land in the store
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the intentional dep
  }, [eventVolExact, live.eventVol, row.ticker, row.eventDate, eventVolVersion]);
  const siRow = useKeyedMapEntry(live.shortInterest, row.ticker);
  const accumRow = useKeyedMapEntry(live.accum, row.ticker);
  const vsRow = useKeyedMapEntry(live.vsXbi, row.ticker);
  const preMktRaw = useKeyedMapEntry(live.preMkt, row.ticker);

  const simDaily = simRow ? dailyChangePctFromRow(simRow) : null;
  const filledVol = fillDeskSessionPriceFromSim(vol, {
    lastPrice: simRow ? currentPriceFromRow(simRow) : null,
    dailyChangePct: simDaily ?? priorSessionPct ?? null,
  });
  const d24Pct = resolveDeskDelta24hPct({
    ticker: row.ticker,
    simDailyPct: simDaily,
    priorSessionPct,
    volRow: filledVol ?? vol,
  });
  // Gray only for outdated carry (market closed / last session print).
  // Live signed % always red or green — never yellow/gray for near-zero.
  const pricePrintStale =
    !liveSession || deskRowIsStaleCarry(vol) || deskRowIsStaleCarry(vsRow);
  const d24Tone: DeskIndexTone = deskSignedLiveTone(d24Pct, {
    stale: pricePrintStale,
  });
  const d24Label = formatSignedPct(d24Pct, 1);
  const d24StaleBadge = deskStaleSessionBadge(vol, it);
  const d24StaleTip = deskStaleProvenanceTip(vol, it);
  const d24Tip =
    d24Pct == null || !Number.isFinite(d24Pct)
      ? it
        ? "Variazione 24h non disponibile (né foglio, né ultima chiusura vs seduta precedente)."
        : "24h change unavailable (no sheet %, no last close vs prior session)."
      : [
          it
            ? `Variazione prezzo ~24h (ultimo prezzo vs chiusura ultima giornata lavorativa): ${d24Label}. Non è Soft BUY/SELL.`
            : `~24h price change (last price vs last trading-day close): ${d24Label}. Not Soft BUY/SELL.`,
          d24StaleTip,
          pricePrintStale
            ? it
              ? "Mercato chiuso / stampa precedente — colore grigio (non live)."
              : "Market closed / prior print — gray (not live)."
            : null,
        ]
          .filter(Boolean)
          .join(" ");
  const visitPct =
    filledVol?.hour_chg_pct != null && Number.isFinite(filledVol.hour_chg_pct)
      ? filledVol.hour_chg_pct
      : vol?.hour_chg_pct != null && Number.isFinite(vol.hour_chg_pct)
        ? vol.hour_chg_pct
        : null;
  const visitTone: DeskIndexTone = deskSignedLiveTone(visitPct, {
    stale: pricePrintStale,
  });
  const visitLabel = formatSignedPct(visitPct, 2);
  const visitTip =
    visitPct == null
      ? it
        ? "Δ vs ultima visita oraria non ancora disponibile (serve almeno due pack desk a ~1h di distanza)."
        : "Δ vs last hourly visit not available yet (needs two desk packs ~1h apart)."
      : [
          it
            ? `Variazione % del prezzo rispetto all’ultima call oraria del desk (last_close vs pack precedente): ${visitLabel}. Non è Soft BUY/SELL.`
            : `Percent price change vs the desk’s previous hourly call (last_close vs prior pack): ${visitLabel}. Not Soft BUY/SELL.`,
          pricePrintStale
            ? it
              ? "Mercato chiuso / stampa precedente — colore grigio (non live)."
              : "Market closed / prior print — gray (not live)."
            : null,
        ]
          .filter(Boolean)
          .join(" ");
  const ivrCell = formatIvrCell(eventVol, it, eventVolLoading && !eventVol);
  const skewCell = formatSkewCell(eventVol, it, eventVolLoading && !eventVol);
  const siCell = formatShortInterestCell(
    siRow,
    it,
    shortInterestLoading && !siRow,
  );
  const accumCell = formatSilentMoneyCell(
    accumRow,
    it,
    accumLoading && !accumRow,
  );
  const govCell = formatGovFlagCell(accumRow, it, accumLoading && !accumRow);
  const vsCell = formatVsXbiCell(vsRow, it, vsXbiLoading && !vsRow);
  const vsTone: DeskIndexTone = deskLiveOrStaleTone(vsCell.tone, {
    stale: pricePrintStale || deskRowIsStaleCarry(vsRow),
    signedPct:
      vsRow?.relative_move != null && Number.isFinite(vsRow.relative_move)
        ? vsRow.relative_move * 100
        : null,
  });
  const preMktRow = applySearchBuzzConfirm(
    preMktRaw,
    searchInterestDeltaPct(trend),
  );
  const preMktCell = formatPreMktConvictionCell(
    preMktRow,
    it,
    preMktLoading && !preMktRaw,
  );
  const diverge = formatPriceVolDivergence(filledVol, it);
  const divergeTone: DeskIndexTone = deskLiveOrStaleTone(diverge.tone, {
    stale: pricePrintStale,
  });
  const biasCell = formatBiasCell(
    {
      rr10: eventVol?.rr10 ?? null,
      priceVolKind: priceVolKindFromLabel(diverge.label),
      insiderNetBuy30d: accumRow?.insider_net_buy_30d ?? null,
      relativeMove: vsRow?.relative_move ?? null,
    },
    it,
  );
  const qty = formatDeskVolumeQtyOnly(vol?.pct_of_prev);
  const qtyTone: DeskIndexTone = deskLiveOrStaleTone(qty.tone, {
    stale: pricePrintStale,
  });
  const trendCell = formatSearchInterestCell(trend, trendsLoading && !trend);
  const trendTip = searchInterestTooltip(
    trend,
    trendCell,
    row.ticker,
    it,
    trendsLoading && !trend,
  );
  const biasPos = biasCell.tone === "up";

  const openTicker = useCallback(() => {
    onOpenTopKpi(row.ticker, row.rowKey);
  }, [onOpenTopKpi, row.ticker, row.rowKey]);

  const openEvent = useCallback(() => {
    onOpenEventRef(
      eventReferenceDoc(
        row,
        it,
        simRow ?? null,
        clinicalRecords,
        companyFallback,
        fdaHit,
      ),
    );
  }, [onOpenEventRef, row, it, simRow, clinicalRecords, companyFallback, fdaHit]);

  const openFda = useCallback(() => {
    if (fdaHit) onOpenBriefing(fdaHit);
  }, [fdaHit, onOpenBriefing]);

  return (
    <tr
      ref={measureElement}
      data-index={virtualIndex}
      data-desk-ticker={row.ticker}
      className={`hover:bg-[rgb(var(--accent))]/[0.03] ${
        biasPos ? "bg-emerald-500/[0.09]" : ""
      }`}
    >
      <td className={`${DESK_CELL_LEFT} font-semibold text-ink`}>
        <TickerCompanyStack
          ticker={row.ticker}
          company={companyNameFromSimRow(simRow) || companyFallback || null}
          companyClassName="text-[9px] text-ink-muted truncate max-w-full leading-snug mt-0.5"
          tickerNode={
            <span className="inline-flex items-center flex-wrap gap-x-1 min-w-0">
              <AttentionStarToggle ticker={row.ticker} it={it} sizeClass="text-[13px]" />
              <button
                type="button"
                className="font-semibold text-[rgb(var(--accent))] hover:underline truncate"
                title={
                  it
                    ? "Apri Deep Dive di questo ticker"
                    : "Open Deep Dive for this ticker"
                }
                onClick={openTicker}
              >
                {row.ticker}
              </button>
              <StudyTypeTickerIcon
                ticker={row.ticker}
                simRow={simRow}
                size={STUDY_DRUG_ICON_PX}
              />
              {debugRenders ? (
                <span
                  className="inline-flex items-center rounded px-1 py-0.5 text-[11px] font-black tabular-nums bg-amber-400 text-black border border-amber-600"
                  title="Debug render count (Step 1 isolation)"
                >
                  {formatDebugRenderBadge(renderN, row.key)}
                </span>
              ) : null}
              {isNewToday ? (
                <span
                  className="text-[11px] leading-none"
                  title={
                    it
                      ? "Nuovo oggi — sparisce da solo a mezzanotte (Roma)"
                      : "New today — clears at midnight (Rome)"
                  }
                  aria-label={it ? "Segnalibro nuovo oggi" : "New today bookmark"}
                >
                  🔖
                </span>
              ) : null}
              {row.inBook ? (
                <span className="text-[10px] font-semibold text-ink-muted">
                  {it ? "libro" : "book"}
                </span>
              ) : null}
            </span>
          }
        />
      </td>
      <td
        className={DESK_CELL}
        title={[productLabel, designationLabel].filter(Boolean).join("\n") || undefined}
      >
        {productLabel || designationLabel ? (
          <span className="inline-flex max-w-full flex-col items-center leading-tight">
            {productLabel ? (
              <button
                type="button"
                className="block w-full truncate text-[11px] font-medium text-[rgb(var(--accent))] hover:underline text-center"
                title={
                  it
                    ? "Apri modality · MoA · target terapeutico"
                    : "Open modality · MoA · therapeutic target"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenProduct?.();
                }}
              >
                {productLabel}
              </button>
            ) : (
              <span className="block w-full truncate text-[11px] font-medium text-ink">
                —
              </span>
            )}
            {designationLabel ? (
              <span className="block w-full truncate text-[9px] text-ink-muted leading-snug">
                {designationLabel}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className={`${DESK_CELL} overflow-hidden`}>
        <NewsDimensionScoreCell scores={newsScores} it={it} />
      </td>
      <td
        className={`${DESK_CELL} leading-tight`}
        title={
          it ? "Clicca per il dettaglio dell’evento" : "Click for event detail"
        }
      >
        <button
          type="button"
          className={`block w-full text-center text-[11px] font-medium tracking-tight hover:underline ${
            row.daysUntil < 0
              ? "text-[rgb(var(--signal-down))] font-semibold hover:text-[rgb(var(--signal-down))]"
              : "text-ink hover:text-[rgb(var(--accent))]"
          }`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openEvent();
          }}
        >
          {deskEventTypeShort(row, it)}
        </button>
      </td>
      <td className={DESK_CELL} title={row.eventDate}>
        <span
          className={`text-[11px] font-medium tabular-nums ${
            row.daysUntil < 0
              ? "text-[rgb(var(--signal-down))] font-semibold"
              : "text-ink"
          }`}
        >
          {formatDeskEventDays(row.daysUntil)}
        </span>
      </td>
      <td className={DESK_CELL} title={biasCell.tip}>
        <DeskIndexText tone={toDeskIndexTone(biasCell.tone)} title={biasCell.tip}>
          <span className="text-[11px] font-medium">{biasCell.label}</span>
          {biasCell.sub ? (
            <span className="text-[9px] font-medium tabular-nums opacity-70">
              {biasCell.sub}
            </span>
          ) : null}
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={trendTip}>
        <DeskIndexText tone={toDeskIndexTone(trendCell.tone)} title={trendTip}>
          <span className="text-[11px] font-medium tabular-nums">{trendCell.label}</span>
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={deskVolumeQtyTooltip(vol, it, liveSession)}>
        <DeskIndexText
          tone={qtyTone}
          title={deskVolumeQtyTooltip(vol, it, liveSession)}
        >
          <span className="text-[11px] font-medium tabular-nums">{qty.label}</span>
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={diverge.tip}>
        <DeskIndexText tone={divergeTone} title={diverge.tip}>
          <span className="text-[11px] font-medium">{diverge.label}</span>
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={ivrCell.tip}>
        <DeskIndexText
          tone={
            ivrCell.staleBadge || ivrCell.emptyReason
              ? "stale"
              : toDeskIndexTone(ivrCell.tone)
          }
          title={ivrCell.tip}
        >
          <span className="text-[11px] font-medium tabular-nums">
            {ivrCell.label}
            {ivrCell.staleBadge ? (
              <span className="ml-0.5 text-[8px] uppercase opacity-70">
                {ivrCell.staleBadge}
              </span>
            ) : null}
          </span>
          {ivrCell.sub ? (
            <span className="text-[9px] font-medium tabular-nums opacity-70">
              {ivrCell.sub}
            </span>
          ) : null}
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={skewCell.tip}>
        <DeskIndexText
          tone={
            skewCell.staleBadge || skewCell.emptyReason
              ? "stale"
              : toDeskIndexTone(skewCell.tone)
          }
          title={skewCell.tip}
        >
          <span className="text-[11px] font-medium tabular-nums">
            {skewCell.label}
            {skewCell.staleBadge ? (
              <span className="ml-0.5 text-[8px] uppercase opacity-70">
                {skewCell.staleBadge}
              </span>
            ) : null}
          </span>
          {skewCell.sub ? (
            <span className="text-[9px] font-medium tabular-nums opacity-70">
              {skewCell.sub}
            </span>
          ) : null}
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={siCell.tip}>
        <DeskIndexText
          tone={deskLiveOrStaleTone(siCell.tone, {
            signedPct:
              siRow?.si_delta_pct != null && Number.isFinite(siRow.si_delta_pct)
                ? siRow.si_delta_pct
                : null,
          })}
          title={siCell.tip}
        >
          <span className="text-[11px] font-medium tabular-nums">
            {siCell.label}
          </span>
          {siCell.sub ? (
            <span className="text-[9px] font-medium tabular-nums text-amber-800 dark:text-amber-200">
              {siCell.sub}
            </span>
          ) : null}
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={vsCell.tip}>
        <DeskIndexText tone={vsTone} title={vsCell.tip}>
          <span className="text-[11px] font-medium tabular-nums">{vsCell.label}</span>
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={visitTip}>
        <DeskIndexText tone={visitTone} title={visitTip}>
          <span className="text-[11px] font-medium tabular-nums">{visitLabel}</span>
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={d24Tip}>
        <DeskIndexText tone={d24Tone} title={d24Tip}>
          <span className="text-[11px] font-medium tabular-nums">
            {d24Label}
            {d24StaleBadge ? (
              <span className="ml-0.5 text-[8px] uppercase opacity-70">
                {d24StaleBadge}
              </span>
            ) : null}
          </span>
        </DeskIndexText>
      </td>
      <td className={DESK_CELL} title={preMktCell.tip}>
        <DeskIndexText
          tone={
            preMktCell.tone === "none" ? "empty" : toDeskIndexTone(preMktCell.tone)
          }
          title={preMktCell.tip}
        >
          <span className="text-[11px] tabular-nums">
            {preMktCell.confirmed ? "✓ " : ""}
            {preMktCell.label}
          </span>
          {preMktCell.sub ? (
            <span className="text-[9px] font-medium opacity-70">{preMktCell.sub}</span>
          ) : null}
        </DeskIndexText>
      </td>
      <td className={DESK_CHIP_CELL}>
        <div className="inline-flex flex-col items-center gap-0.5 max-w-full">
          <DeskIndexText tone={toDeskIndexTone(accumCell.tone)} title={accumCell.tip}>
            <span
              className="text-[11px] font-medium leading-tight cursor-help"
              title={accumCell.tip}
            >
              {accumCell.label}
            </span>
            {accumCell.sub ? (
              <span
                className="text-[9px] font-medium opacity-70 cursor-help"
                title={accumCell.tip}
              >
                {accumCell.sub}
              </span>
            ) : null}
          </DeskIndexText>
          {accumCell.href ? (
            <a
              href={accumCell.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] font-medium text-[rgb(var(--accent))] hover:underline"
              title={it ? "Apri filing SEC" : "Open SEC filing"}
            >
              SEC
            </a>
          ) : null}
        </div>
      </td>
      <td className={DESK_CHIP_CELL} title={govCell.tip}>
        <DeskIndexText
          tone={govCell.tone === "none" ? "empty" : toDeskIndexTone(govCell.tone)}
          title={govCell.tip}
        >
          <span
            className={`text-[11px] font-medium leading-tight ${
              govCell.tone === "down" ? "text-rose-700 dark:text-rose-300" : ""
            }`}
          >
            {govCell.label}
          </span>
        </DeskIndexText>
      </td>
      <td
        className={`${DESK_CELL}${fdaHit ? " cursor-pointer" : ""}`}
        title={
          fdaHit
            ? it
              ? "Apri il riepilogo del meeting FDA (titolo, oggetto, materiali)"
              : "Open FDA meeting summary (title, subject, materials)"
            : undefined
        }
        onClick={openFda}
      >
        <FdaBriefingCell
          row={fdaHit}
          days={row.daysUntil}
          it={it}
          onOpen={openFda}
        />
      </td>
      {showRecCol ? (
        <td className={DESK_CELL} title={recTitle}>
          <span
            className={`inline-flex max-w-full truncate text-[10px] font-bold uppercase tracking-tight ${recToneClass}`}
          >
            {recLabel || "—"}
          </span>
        </td>
      ) : null}
    </tr>
  );
}

export const HomeSignalsDeskRow = memo(HomeSignalsDeskRowImpl, (prev, next) => {
  if (prev.live !== next.live) return false;
  if (prev.row.key !== next.row.key) return false;
  if (prev.row.ticker !== next.row.ticker) return false;
  // daysUntil may jitter by 1 from float rounding — still same row; allow update
  // without treating unrelated prop churn as a full invalidation elsewhere.
  if (prev.row.daysUntil !== next.row.daysUntil) return false;
  if (prev.row.eventDate !== next.row.eventDate) return false;
  if (prev.row.source !== next.row.source) return false;
  if (prev.row.inBook !== next.row.inBook) return false;
  if (prev.it !== next.it) return false;
  if (prev.liveSession !== next.liveSession) return false;
  if (!tickerRowShallowEqual(prev.simRow, next.simRow)) return false;
  if (prev.companyFallback !== next.companyFallback) return false;
  if (prev.productLabel !== next.productLabel) return false;
  if (prev.designationLabel !== next.designationLabel) return false;
  if (prev.newsScores !== next.newsScores) {
    const a = prev.newsScores;
    const b = next.newsScores;
    if (!a || !b) return false;
    if (
      a.eis !== b.eis ||
      a.clinical !== b.clinical ||
      a.financial !== b.financial ||
      a.corporate !== b.corporate ||
      a.marketAccess !== b.marketAccess
    ) {
      return false;
    }
  }
  if (prev.priorSessionPct !== next.priorSessionPct) return false;
  if (prev.fdaHit !== next.fdaHit) {
    const a = prev.fdaHit;
    const b = next.fdaHit;
    if (!a || !b) return false;
    if (a.ticker !== b.ticker || a.date !== b.date) return false;
    if (a.briefing?.score !== b.briefing?.score) return false;
    if (a.briefing?.pdfUrl !== b.briefing?.pdfUrl) return false;
    if (a.briefing?.materialsUrl !== b.briefing?.materialsUrl) return false;
    if (a.briefing?.status !== b.briefing?.status) return false;
    if (a.briefing?.matchOk !== b.briefing?.matchOk) return false;
  }
  if (prev.virtualIndex !== next.virtualIndex) return false;
  if (prev.measureElement !== next.measureElement) return false;
  if (prev.isNewToday !== next.isNewToday) return false;
  if (prev.clinicalRecords !== next.clinicalRecords) return false;
  if (prev.showRecCol !== next.showRecCol) return false;
  if (prev.recLabel !== next.recLabel) return false;
  if (prev.recToneClass !== next.recToneClass) return false;
  // Live cells subscribe per-key; ignore global loading flips here.
  return true;
});
