/**
 * NotificationBell — bell with badge and dropdown of signal alerts.
 * Mounted in the top bar. Marks all as read when opened.
 */

import { useEffect, useRef, useState } from "react";
import type { AlertKind, SignalAlert } from "../hooks/useSignalAlerts";
import { useLang, useT, type TranslationKey } from "../shared/i18n";

// ── config per kind ──────────────────────────────────────────────────────────

type KindCfg = { emoji: string; labelKey: TranslationKey; pillCls: string };

const KIND_CFG: Record<AlertKind, KindCfg> = {
  forte: {
    emoji:    "⚡",
    labelKey: "bell.kind.forte",
    pillCls:  "border-[rgb(var(--signal-up))]/35 text-[rgb(var(--signal-up))] bg-[rgb(var(--signal-up))]/8",
  },
  watch: {
    emoji:    "▲",
    labelKey: "bell.kind.watch",
    pillCls:  "border-[rgb(var(--accent))]/35 text-[rgb(var(--accent))] bg-[rgb(var(--accent))]/8",
  },
  short: {
    emoji:    "▼",
    labelKey: "bell.kind.short",
    pillCls:  "border-[rgb(var(--signal-down))]/35 text-[rgb(var(--signal-down))] bg-[rgb(var(--signal-down))]/8",
  },
  exit: {
    emoji:    "↩",
    labelKey: "bell.kind.exit",
    pillCls:  "border-[rgb(var(--warn))]/40 text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/8",
  },
  stop: {
    emoji:    "🛑",
    labelKey: "bell.kind.stop",
    pillCls:  "border-[rgb(var(--signal-down))]/50 text-[rgb(var(--signal-down))] bg-[rgb(var(--signal-down))]/12 font-bold",
  },
  slope_dec: {
    emoji:    "🟠",
    labelKey: "bell.kind.slopeDec",
    pillCls:  "border-[rgb(var(--warn))]/40 text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/8",
  },
  slope_rev: {
    emoji:    "🔴",
    labelKey: "bell.kind.slopeRev",
    pillCls:  "border-[rgb(var(--signal-down))]/50 text-[rgb(var(--signal-down))] bg-[rgb(var(--signal-down))]/12 font-bold",
  },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtRelTime(ts: number, t: (k: TranslationKey, vars?: Record<string, string | number>) => string, locale: string): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)      return t("common.now");
  if (diff < 3_600_000)   return t("common.minAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000)  return t("common.hAgo",   { n: Math.floor(diff / 3_600_000) });
  return new Date(ts).toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

// ── component ────────────────────────────────────────────────────────────────

export function NotificationBell({
  alerts,
  unreadCount,
  onMarkAllRead,
  onClearAll,
  onDismiss,
}: {
  alerts: SignalAlert[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onDismiss: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "it" ? "it-IT" : "en-US";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) onMarkAllRead();
  }

  // Group by kind priority for display
  const urgent = alerts.filter((a) => a.kind === "stop" || a.kind === "exit" || a.kind === "slope_rev");
  const invest = alerts.filter((a) => a.kind === "forte" || a.kind === "short");
  const watch  = alerts.filter((a) => a.kind === "watch");
  const slope  = alerts.filter((a) => a.kind === "slope_dec");
  const ordered = [...urgent, ...invest, ...watch, ...slope];

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={handleToggle}
        title={unreadCount > 0 ? t("bell.title.unread", { n: unreadCount }) : t("bell.title.idle")}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
          open
            ? "bg-[rgb(var(--accent))]/20 text-[rgb(var(--accent))]"
            : unreadCount > 0
              ? "text-[rgb(var(--warn))] hover:bg-[rgb(var(--surface-3))]/40"
              : "text-ink-muted hover:bg-[rgb(var(--surface-3))]/40"
        }`}
      >
        <span className="text-[18px] leading-none select-none">
          {unreadCount > 0 ? "🔔" : "🔕"}
        </span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] rounded-full bg-[rgb(var(--signal-down))] text-white text-[8px] font-bold flex items-center justify-center px-[3px] tabular-nums leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[380px] rounded-xl border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] shadow-[0_8px_40px_rgba(0,0,0,0.35)] z-[500] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--border))]/40">
            <div>
              <p className="text-sm font-semibold">{t("bell.header.title")}</p>
              <p className="text-[10px] text-ink-muted">
                {alerts.length === 0
                  ? t("bell.header.noSignals")
                  : alerts.length === 1
                    ? t("bell.header.summarySingular", { n: alerts.length })
                    : t("bell.header.summaryPlural",   { n: alerts.length })}
              </p>
            </div>
            {alerts.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-[10px] text-ink-muted hover:text-[rgb(var(--signal-down))] transition ml-3"
              >
                {t("bell.btn.clearAll")}
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[440px]">
            {ordered.length === 0 ? (
              <div className="py-12 text-center px-4">
                <p className="text-4xl mb-3">🔕</p>
                <p className="text-sm font-medium text-ink-muted">{t("bell.empty.title")}</p>
                <p className="text-[11px] text-ink-muted/60 mt-1 leading-snug">
                  {t("bell.empty.body")}
                </p>
              </div>
            ) : (
              ordered.map((a) => {
                const cfg = KIND_CFG[a.kind];
                return (
                  <div
                    key={a.id}
                    className={`group relative flex gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/25 transition-colors hover:bg-[rgb(var(--surface-3))]/20 ${
                      !a.read ? "bg-[rgb(var(--accent))]/[0.04]" : ""
                    }`}
                  >
                    {/* Unread dot */}
                    {!a.read && (
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[rgb(var(--accent))]" />
                    )}

                    {/* Emoji */}
                    <span className="text-xl shrink-0 mt-0.5 select-none">{cfg.emoji}</span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[13px] tracking-tight">{a.ticker}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-[2px] rounded-full border ${cfg.pillCls}`}>
                          {t(cfg.labelKey)}
                        </span>
                        {a.score > 0 && (
                          <span className="text-[9px] text-ink-muted/70">Score {a.score}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">{a.message}</p>
                      <p className="text-[10px] text-ink-muted/50 mt-1">
                        CD {a.cd}
                        {a.days != null
                          ? a.days >= 0
                            ? t("bell.cd.inDays", {
                                n: a.days,
                                unit: a.days === 1 ? t("common.day") : t("common.days"),
                              })
                            : t("bell.cd.past")
                          : ""}
                        {" · "}
                        {fmtRelTime(a.timestamp, t, locale)}
                      </p>
                    </div>

                    {/* Dismiss */}
                    <button
                      type="button"
                      onClick={() => onDismiss(a.id)}
                      title={t("bell.btn.dismiss")}
                      className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] text-ink-muted/30 hover:text-ink-muted hover:bg-[rgb(var(--surface-3))]/40 opacity-0 group-hover:opacity-100 transition self-start mt-0.5"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {alerts.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[rgb(var(--border))]/30 bg-[rgb(var(--surface))]/60">
              <p className="text-[10px] text-ink-muted/50 text-center">
                {t("bell.footer.native")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
