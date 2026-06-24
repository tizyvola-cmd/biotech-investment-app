import type { ReactNode } from "react";
import { useMobileLang } from "../hooks/useMobileLang";

export type Accent = "up" | "down" | "warn" | "accent" | "neutral";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? 28 : 32;
  return (
    <div
      className="brand-mark"
      style={{ width: dim, height: dim, fontSize: size === "sm" ? "0.85rem" : "0.95rem" }}
      aria-hidden
    >
      ✦
    </div>
  );
}

export function HeroKpi({
  label,
  value,
  sub,
  accent = "accent",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: Accent;
}) {
  return (
    <div className={`hero-kpi accent-${accent}`}>
      <p className="hero-kpi-label">{label}</p>
      <p className="hero-kpi-value">{value}</p>
      {sub ? <p className="hero-kpi-sub">{sub}</p> : null}
    </div>
  );
}

export function FeedPanel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`feed-panel${className ? ` ${className}` : ""}`}>
      <div className="feed-panel-head">
        <div className="feed-panel-head-text">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="feed-panel-action">{action}</div> : null}
      </div>
      <div className="feed-panel-body">{children}</div>
    </section>
  );
}

export function PageToolbar({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-toolbar">
      <div>
        <h2 className="page-toolbar-title">{title}</h2>
        {subtitle ? <p className="page-toolbar-sub">{subtitle}</p> : null}
      </div>
      {action ? <div className="page-toolbar-action">{action}</div> : null}
    </div>
  );
}

export function MobileRowCard({
  ticker,
  title,
  metaLeft,
  metaRight,
  badge,
  badgeTone = "neutral",
  externalLink,
  onClick,
}: {
  ticker: string;
  title?: string;
  metaLeft?: ReactNode;
  metaRight?: ReactNode;
  badge?: string;
  badgeTone?: "up" | "down" | "hot" | "watch" | "warn" | "neutral";
  externalLink?: { href: string; label: string };
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);
  return (
    <div
      className={`mobile-row-card${clickable ? " mobile-row-card--clickable" : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="mobile-row-top">
        <div className="mobile-row-id">
          <strong>{ticker}</strong>
          {title ? <span className="mobile-row-reason">{title}</span> : null}
        </div>
        {badge ? <span className={`pill pill-${badgeTone}`}>{badge}</span> : null}
      </div>
      {(metaLeft || metaRight) && (
        <div className="mobile-row-meta">
          <span>{metaLeft}</span>
          <span>{metaRight}</span>
        </div>
      )}
      {externalLink ? (
        <a
          className="mobile-row-external-link"
          href={externalLink.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {externalLink.label}
        </a>
      ) : null}
    </div>
  );
}

export function SegToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; badge?: number }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="seg-toggle-track">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? "seg-btn-active" : "seg-btn"}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.badge != null && o.badge > 0 ? <span className="seg-badge">{o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function RefreshBtn({ busy, onClick }: { busy?: boolean; onClick: () => void }) {
  const { t } = useMobileLang();
  return (
    <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={onClick}>
      {busy ? "…" : `↻ ${t("common.refresh")}`}
    </button>
  );
}

export function LinkAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="link-btn" onClick={onClick}>
      {label}
    </button>
  );
}

/** Lista opportunità mobile — solo ticker, countdown CD e un ROI (no nome società). */
export function OpportunityCard({
  ticker,
  daysLabel,
  zone,
  metricLabel,
  metricValue,
  metricTone = "accent",
  onClick,
}: {
  ticker: string;
  daysLabel: string;
  zone: "hot" | "watch";
  metricLabel: string;
  metricValue: string;
  metricTone?: "up" | "down" | "accent" | "neutral";
  onClick?: () => void;
}) {
  return (
    <button type="button" className="opp-card" onClick={onClick}>
      <div className="opp-card-head">
        <strong className="opp-card-ticker">{ticker}</strong>
        <span className={`pill pill-${zone === "hot" ? "hot" : "watch"}`}>{daysLabel}</span>
      </div>
      <div className="opp-card-metric">
        <span className="opp-card-metric-label">{metricLabel}</span>
        <strong className={`opp-card-metric-value tone-${metricTone}`}>{metricValue}</strong>
      </div>
    </button>
  );
}
