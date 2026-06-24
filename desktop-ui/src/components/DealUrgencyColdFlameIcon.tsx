import { useId } from "react";

/** Leggibile in tabella accanto al ticker (hot 🔥 usa la stessa base). */
export const DEAL_URGENCY_ICON_SIZE = 24;

/**
 * Fiamma blu gelida — specchio visivo del 🔥 hot, silhouette grassa e contrastata.
 * Più leggibile di fiocchi/cubetti a 20px su righe azzurre.
 */
export function DealUrgencyColdFlameIcon({
  size = DEAL_URGENCY_ICON_SIZE,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className ?? "shrink-0 deal-urgency-cold-icon"}
      aria-hidden
    >
      <defs>
        <linearGradient id={`cf-${uid}`} x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="35%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <filter id={`cf-shadow-${uid}`} x="-25%" y="-15%" width="150%" height="140%">
          <feDropShadow dx="0" dy="0.8" stdDeviation="0.6" floodColor="#1e3a8a" floodOpacity="0.45" />
        </filter>
      </defs>

      <g filter={`url(#cf-shadow-${uid})`}>
        {/* Ghiaccio / fiamma fredda — forma simile al fuoco ma blu */}
        <path
          fill={`url(#cf-${uid})`}
          stroke="#1e3a8a"
          strokeWidth="1.35"
          strokeLinejoin="round"
          d="M12 2.2c-1.2 2.8-3.4 4.6-3.8 7.2-.3 1.8.4 3.1 1.4 4.1-.9-.2-1.6-1-1.6-2.2 0 2.6 1.8 4.8 4.2 5.8-.6-1.5-.2-3.2 1-4.4.3 2.1 1.6 3.9 3.4 4.9.2-2.5 1.5-4.6 3.4-5.9-1.1 1.6-1.3 3.6-.5 5.3 1.5-.9 2.5-2.5 2.5-4.4 0 3.4-2.8 6.2-6.2 6.2h-.8c-3.4 0-6.2-2.8-6.2-6.2 0-2.2 1.2-4.1 3-5.2C7.2 8.8 9.8 6.2 12 2.2Z"
        />
        {/* Riflesso ghiaccio */}
        <path
          fill="#f0f9ff"
          fillOpacity="0.85"
          d="M10.2 9.5c.8-1.2 1.4-2.6 1.6-4.1-.9 1.5-2.1 2.8-2.8 4.5-.4.9-.1 1.8.5 2.4-.6-.1-1-.5-1-1.1.1 1.3.9 2.4 2.1 2.9-.3-.8-.1-1.6.4-2.2Z"
        />
        {/* Gocciolina — “sta sciogliendo / freddo che cola” */}
        <path
          fill="#0ea5e9"
          stroke="#1e3a8a"
          strokeWidth="0.7"
          d="M12 20.8c-.55 0-1 .35-1 .78 0 .55.45 1.05 1 1.05s1-.5 1-1.05c0-.43-.45-.78-1-.78Z"
        />
      </g>
    </svg>
  );
}

/** @deprecated Use DealUrgencyColdFlameIcon */
export const DealUrgencySnowflakeIcon = DealUrgencyColdFlameIcon;
export const MeltingIceStackIcon = DealUrgencyColdFlameIcon;
