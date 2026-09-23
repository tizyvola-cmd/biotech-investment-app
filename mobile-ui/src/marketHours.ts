/**
 * NASDAQ market hours helpers.
 *
 * Regular session: Mon–Fri 09:30–16:00 America/New_York.
 * Pre-market: 04:00–09:30 ET · After-hours: 16:00–20:00 ET.
 *
 * The desktop workbook's "Prezzo Corrente ($)" column normally holds the last
 * regular-session close price, so during a closed session the last close is a
 * more consistent buy-price reference than an arbitrary user entry.
 *
 * Note: this helper intentionally ignores US market holidays. When the market
 * is technically closed on a holiday but this function returns "open", the
 * consequence is only that we skip the auto-snap safeguard on that day — the
 * tester keeps full manual control. That is preferable to shipping a stale
 * holiday calendar with the mobile bundle.
 */

export type NasdaqSession = "regular" | "premarket" | "afterhours" | "closed" | "weekend";

export type NasdaqStatus = {
  session: NasdaqSession;
  open: boolean;
  minutesEtNow: number;
};

const MIN_REGULAR_OPEN = 9 * 60 + 30; // 09:30 ET
const MIN_REGULAR_CLOSE = 16 * 60; // 16:00 ET
const MIN_PREMARKET_OPEN = 4 * 60; // 04:00 ET
const MIN_AFTERHOURS_CLOSE = 20 * 60; // 20:00 ET

function nyParts(now: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdayMap[wd] ?? 1, minutes: hh * 60 + mm };
}

export function getNasdaqStatus(now: Date = new Date()): NasdaqStatus {
  const { weekday, minutes } = nyParts(now);
  if (weekday === 0 || weekday === 6) {
    return { session: "weekend", open: false, minutesEtNow: minutes };
  }
  if (minutes >= MIN_REGULAR_OPEN && minutes < MIN_REGULAR_CLOSE) {
    return { session: "regular", open: true, minutesEtNow: minutes };
  }
  if (minutes >= MIN_PREMARKET_OPEN && minutes < MIN_REGULAR_OPEN) {
    return { session: "premarket", open: false, minutesEtNow: minutes };
  }
  if (minutes >= MIN_REGULAR_CLOSE && minutes < MIN_AFTERHOURS_CLOSE) {
    return { session: "afterhours", open: false, minutesEtNow: minutes };
  }
  return { session: "closed", open: false, minutesEtNow: minutes };
}

export function isNasdaqRegularOpen(now: Date = new Date()): boolean {
  return getNasdaqStatus(now).session === "regular";
}
