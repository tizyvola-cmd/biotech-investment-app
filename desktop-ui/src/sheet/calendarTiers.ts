/**
 * Three-tier catalyst calendar (display membership only — Soft BUY/SELL unchanged).
 *
 * 1. **Internal store** (hidden): full SEC / guidance / FDA / CD history on the
 *    server (`catalyst_calendar_*`, guidance snapshot, …). Never rendered as a tab.
 * 2. **Calendar tab**: future events with anchor ≤ {@link CALENDAR_FORWARD_HORIZON_DAYS}
 *    (~6 months) migrate into the visible Calendar.
 * 3. **Catalyst Days**: events with anchor ≤ {@link CALENDAR_CATALYST_HORIZON_DAYS}
 *    (20 days), plus red-★ priority names. Catalyst keeps collecting desk columns
 *    only for this near window; farther dates stay in the internal store (± Calendar).
 */
export {
  CALENDAR_FORWARD_HORIZON_DAYS,
  CALENDAR_CATALYST_HORIZON_DAYS,
  CALENDAR_MIGRATE_HORIZON_DAYS,
  isWithinCalendarForwardHorizon,
  isWithinMigrateHorizon,
  isWithinCatalystHorizon,
} from "./calendarPhase1";
