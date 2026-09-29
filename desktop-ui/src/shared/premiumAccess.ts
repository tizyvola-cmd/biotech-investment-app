/**
 * Public vs Premium membership (VPS web / browser).
 * Premium = meta.premium OR owner email (tizyvola@gmail.com) OR lab skip.
 * Public / Basic approved testers can open Catalyst + Deep Dive;
 * Calendar / Discovery / COI enroll stay gated.
 *
 * Unlock CTA → join Premium waitlist (Access tab for the operator).
 */
import { joinPremiumWaitlist } from "../api/testerFeedback";
import { getStoredTester, isAllowedOwnerEmail } from "../sheet/testerSession";

export const LANDING_PANEL_KEY = "sn_landing_panel";
export const OPEN_PREMIUM_REQUEST_EVENT = "supernova:open-premium-request";
export const PREMIUM_WAITLIST_JOINED_EVENT = "supernova:premium-waitlist-joined";

export function hasPremiumMembership(
  gate: string,
  opts?: { premium?: boolean | null; email?: string | null },
): boolean {
  // Local Electron / no gate — full product for the operator machine.
  if (gate === "skip") return true;
  if (gate !== "ready") return false;
  if (isAllowedOwnerEmail(opts?.email ?? "")) return true;
  return Boolean(opts?.premium);
}

/**
 * Request Premium: if signed in, join the waitlist (shows in Access).
 * Otherwise open landing Premium card.
 */
export function openPremiumAccessRequest(): void {
  if (typeof window === "undefined") return;
  const email = (getStoredTester()?.email || "").trim();
  if (email.includes("@")) {
    void joinPremiumWaitlist(email)
      .then((res) => {
        try {
          window.dispatchEvent(
            new CustomEvent(PREMIUM_WAITLIST_JOINED_EVENT, {
              detail: {
                email,
                already: Boolean(res.already),
                position: res.position ?? null,
              },
            }),
          );
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        // Fall back to landing Premium panel if join fails.
        openLandingPremiumPanel();
      });
    return;
  }
  openLandingPremiumPanel();
}

/** Leave the public app and open landing → Premium waitlist card. */
export function openLandingPremiumPanel(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(LANDING_PANEL_KEY, "premium");
    sessionStorage.removeItem("sn_web_entered");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(OPEN_PREMIUM_REQUEST_EVENT));
  } catch {
    /* ignore */
  }
}

export function consumeLandingPanelPreference(): "request" | "premium" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LANDING_PANEL_KEY);
    sessionStorage.removeItem(LANDING_PANEL_KEY);
    if (raw === "premium") return "premium";
    return raw === "request" ? "request" : null;
  } catch {
    return null;
  }
}
