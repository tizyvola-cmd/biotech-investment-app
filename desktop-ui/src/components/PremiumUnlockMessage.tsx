/**
 * Centered unlock copy for Calendar / Discovery (and COI).
 * The words "premium membership" are the Request Access link → waitlist (Access tab).
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  openPremiumAccessRequest,
  PREMIUM_WAITLIST_JOINED_EVENT,
} from "../shared/premiumAccess";
import { useT, type TranslationKey } from "../shared/i18n";

function PremiumLink({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`font-semibold text-[#F3C451] underline decoration-[#F3C451]/55 underline-offset-2 hover:brightness-110 ${className}`.trim()}
      onClick={() => openPremiumAccessRequest()}
    >
      {t("premium.unlock.link")}
    </button>
  );
}

/** Renders body with "premium membership" replaced by the Request Access link. */
export function PremiumUnlockMessage({
  bodyKey,
  className = "",
}: {
  bodyKey: TranslationKey;
  className?: string;
}) {
  const t = useT();
  const body = t(bodyKey);
  const link = t("premium.unlock.link");
  const idx = body.toLowerCase().indexOf(link.toLowerCase());
  const [joinedNote, setJoinedNote] = useState<string | null>(null);

  useEffect(() => {
    const onJoined = (ev: Event) => {
      const detail = (ev as CustomEvent<{ already?: boolean; position?: number | null }>).detail;
      const pos =
        typeof detail?.position === "number" && detail.position > 0
          ? ` (#${detail.position})`
          : "";
      setJoinedNote(
        detail?.already
          ? `Already on the Premium waitlist${pos}. The operator will approve you from Access.`
          : `Premium request sent${pos}. The operator will see it in Access and can grant full app access.`,
      );
    };
    window.addEventListener(PREMIUM_WAITLIST_JOINED_EVENT, onJoined);
    return () => window.removeEventListener(PREMIUM_WAITLIST_JOINED_EVENT, onJoined);
  }, []);

  let content: ReactNode;
  if (idx >= 0) {
    content = (
      <>
        {body.slice(0, idx)}
        <PremiumLink />
        {body.slice(idx + link.length)}
      </>
    );
  } else {
    content = (
      <>
        {t("premium.unlock.prefix")} <PremiumLink /> {body}
      </>
    );
  }

  return (
    <div
      className={`flex w-full flex-col items-center justify-center gap-3 px-6 ${className || "flex-1 min-h-0 py-10"}`.trim()}
      role="status"
    >
      <p className="max-w-xl text-center text-[15px] sm:text-[16px] leading-relaxed text-[#F3F5FA] drop-shadow-[0_2px_16px_rgba(11,13,23,0.95)]">
        {content}
      </p>
      {joinedNote ? (
        <p className="max-w-md text-center text-[13px] leading-snug text-[#34D399]">{joinedNote}</p>
      ) : null}
    </div>
  );
}

/**
 * Locked Premium tab — real Calendar/Discovery underneath, blurred + inert,
 * with the unlock message centered on top.
 */
export function PremiumLockedPreview({
  bodyKey,
  children,
  fill = "stretch",
}: {
  bodyKey: TranslationKey;
  /** Live panel shown blurred behind the unlock message. */
  children?: ReactNode;
  fill?: "stretch" | "cover";
}) {
  const shell =
    fill === "cover"
      ? "absolute inset-0 overflow-hidden bg-[#0B0D17]"
      : "relative w-full min-w-0 min-h-0 flex-1 overflow-hidden bg-[#0B0D17]";

  return (
    <div className={shell}>
      {children ? (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden select-none"
          aria-hidden
        >
          <div
            className="h-full w-full origin-center"
            style={{
              filter: "blur(8px) saturate(0.85)",
              transform: "scale(1.03)",
              opacity: 0.72,
            }}
          >
            {children}
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden>
          <div className="mx-auto mt-10 w-[min(92%,56rem)] space-y-2 px-4">
            <div className="h-3 w-1/3 rounded bg-white/10" />
            <div className="h-8 rounded-lg bg-white/[0.06] border border-white/[0.08]" />
            <div className="h-40 rounded-xl bg-white/[0.04] border border-white/[0.06]" />
            <div className="h-24 rounded-xl bg-white/[0.04] border border-white/[0.06]" />
          </div>
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-0 z-[5] bg-[#0B0D17]/45"
        aria-hidden
      />
      <div className="absolute inset-0 z-10 flex items-center justify-center px-6 py-10">
        <PremiumUnlockMessage bodyKey={bodyKey} className="flex-none py-0" />
      </div>
    </div>
  );
}
