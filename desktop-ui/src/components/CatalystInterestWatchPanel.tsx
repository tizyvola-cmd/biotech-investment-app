/**
 * Catalyst Days — enroll tickers of interest into Catalyst table + Top KPI + Deep Dive.
 * Yellow ★ from Catalyst list; red ★ after you enroll a ticker by hand.
 * Public (non-premium): unlock CTA only — enroll is membership-gated.
 */
import { useState } from "react";
import { enrollCatalystInterest } from "../api/supernova";
import { notifyCatalystInterestChanged } from "../hooks/useCatalystInterestTickers";
import { openCalendarForTicker } from "../sheet/calendarFocusStore";
import { useLang, useT } from "../shared/i18n";
import { openPremiumAccessRequest } from "../shared/premiumAccess";
import { PremiumUnlockMessage } from "./PremiumUnlockMessage";

function normalizeTickerInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
}

function PremiumTitleStar() {
  return (
    <svg aria-hidden viewBox="0 0 400 400" className="h-[15px] w-[15px] shrink-0">
      <defs>
        <linearGradient id="interestTitleStarFill" x1="18%" y1="6%" x2="86%" y2="94%">
          <stop offset="0%" stopColor="#F8E7A0" />
          <stop offset="45%" stopColor="#F3C451" />
          <stop offset="100%" stopColor="#E59A1A" />
        </linearGradient>
      </defs>
      <path
        fill="url(#interestTitleStarFill)"
        d="M200 12 L243.8 156.2 L388 200 L243.8 243.8 L200 388 L156.2 243.8 L12 200 L156.2 156.2 Z"
      />
    </svg>
  );
}

export function CatalystInterestWatchPanel({
  onEnrolled,
  className = "",
  embedded = false,
  hasPremium = true,
}: {
  onEnrolled?: (ticker: string) => void | Promise<unknown>;
  className?: string;
  /** Nested under Top News — no extra card chrome, one compact row. */
  embedded?: boolean;
  /** Approved membership — enroll form. Public sees unlock CTA. */
  hasPremium?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const [ticker, setTicker] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleEnroll = async () => {
    const tk = normalizeTickerInput(ticker);
    if (!tk) {
      setErr(t("catalystInterest.error.tickerRequired"));
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await enrollCatalystInterest({
        ticker: tk,
        company: company.trim() || undefined,
        open_pipeline: true,
        discover: true,
      });
      if (!res?.ok) {
        setErr(res?.error || t("catalystInterest.error.enrollFailed"));
        return;
      }
      const cd = res.cd_iso || res.entry?.cd_iso || res.discovery?.candidate?.cd_date;
      const src = res.discovery?.source || res.discovery?.candidate?.source;
      const days = res.discovery?.days_until;
      if (cd) {
        const dayBit =
          days != null
            ? it
              ? ` · ${days}g`
              : ` · ${days}d`
            : "";
        setMsg(
          t("catalystInterest.successCd", {
            ticker: tk,
            cd,
            src: src || (it ? "calendario" : "calendar"),
            extra: dayBit,
          }),
        );
      } else {
        setMsg(t("catalystInterest.successNoCd", { ticker: tk }));
      }
      setTicker("");
      setCompany("");
      notifyCatalystInterestChanged();
      await onEnrolled?.(tk);
      openCalendarForTicker(tk);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message.slice(0, 160)
          : t("catalystInterest.error.enrollFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={
        embedded
          ? `space-y-2 ${className}`.trim()
          : `rounded-xl border border-white/[0.08] bg-[rgb(var(--surface))] px-4 py-3 space-y-2 ${className}`.trim()
      }
      aria-label={t("catalystInterest.title")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <PremiumTitleStar />
            <h3 className="text-[12px] font-bold tracking-tight text-[#F3F5FA]">
              {t("catalystInterest.title")}
            </h3>
          </div>
          {hasPremium ? (
            <p className="mt-0.5 text-[10px] leading-snug text-[#97A2BA]">
              {t("catalystInterest.lead")}
            </p>
          ) : (
            <p className="mt-0.5 text-[10px] leading-snug text-[#97A2BA]">
              {t("catalystInterest.baseHourlyNote")}
            </p>
          )}
        </div>
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded-full border border-[#F3C451]/50 bg-[#F3C451]/12 px-2 py-[3px] text-[8px] font-bold uppercase tracking-[0.14em] text-[#F3C451] whitespace-nowrap hover:brightness-110"
          onClick={() => openPremiumAccessRequest()}
          title={t("catalystInterest.premium")}
        >
          {t("catalystInterest.premium")}
        </button>
      </div>

      {hasPremium ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 shrink-0">
              <span className="text-[8px] font-bold uppercase tracking-wide text-[#97A2BA]">
                {t("catalystInterest.field.ticker")}
              </span>
              <input
                className="rounded-md border border-white/[0.08] bg-[rgb(var(--surface-elevated))] px-2.5 py-1.5 w-[6.5rem] text-[12px] font-semibold uppercase text-ink placeholder:text-[#5B6580] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--accent))]/50"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleEnroll();
                }}
                placeholder="CRDL"
                maxLength={8}
                disabled={busy}
                aria-label={t("catalystInterest.field.ticker")}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[8px] font-bold uppercase tracking-wide text-[#97A2BA]">
                {t("catalystInterest.field.company")}
              </span>
              <input
                className="rounded-md border border-white/[0.08] bg-[rgb(var(--surface-elevated))] px-2.5 py-1.5 w-full text-[12px] text-ink placeholder:text-[#5B6580] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--accent))]/50"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleEnroll();
                }}
                placeholder={it ? "Nome società (opz.)" : "Company name (opt.)"}
                disabled={busy}
                aria-label={t("catalystInterest.field.company")}
              />
            </label>
            <button
              type="button"
              className="rounded-md bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-50 text-white text-[12px] font-semibold px-4 py-1.5 shrink-0"
              disabled={busy}
              onClick={() => void handleEnroll()}
            >
              {busy ? t("catalystInterest.busy") : t("catalystInterest.action.enroll")}
            </button>
          </div>

          {err ? (
            <p className="text-[10px] font-semibold text-[rgb(var(--signal-down))]">{err}</p>
          ) : null}
          {msg ? (
            <p className="text-[10px] font-semibold text-[rgb(var(--signal-up))]">{msg}</p>
          ) : null}
        </>
      ) : (
        <PremiumUnlockMessage
          bodyKey="premium.unlock.companiesOfInterest"
          className="py-4 min-h-[4.5rem]"
        />
      )}
    </section>
  );
}
