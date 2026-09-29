/**
 * High-tech / AI desk — coming soon (light aqua #0efdc8 + SuperNova violet).
 * Shared by landing + in-app PlatformRail. No Notify me — use landing Contact.
 */
import {
  HITECH_GREEN,
  HITECH_GREEN_RGB,
} from "./hitechAccent";

export function WorkInProgressIcon({ className = "h-16 w-16" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 64 64" className={className} fill="none">
      <circle cx="32" cy="32" r="30" stroke="#9B8CFF" strokeOpacity="0.35" strokeWidth="2" />
      <circle
        cx="32"
        cy="32"
        r="22"
        stroke={HITECH_GREEN}
        strokeOpacity="0.55"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <path
        d="M20 40V28l6-4 6 4v12M32 28l6-4 6 4v12"
        stroke="#9B8CFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18 44h28" stroke={HITECH_GREEN} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M26 22l2.5-5h7L38 22"
        stroke={HITECH_GREEN}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="18" r="2.5" fill={HITECH_GREEN} />
    </svg>
  );
}

export function HighTechComingSoonView({
  onBackBiotech,
}: {
  onBackBiotech: () => void;
  /** @deprecated Notify me removed — ignored. */
  showNotify?: boolean;
  /** @deprecated Notify me removed — ignored. */
  initialEmail?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:py-16 min-h-0 overflow-y-auto bg-[#07080F] text-[#F3F5FA]">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center space-y-8">
        <div className="relative">
          <div
            className="absolute inset-0 -m-8 rounded-full bg-[radial-gradient(circle,rgba(155,140,255,0.22),transparent_65%)]"
            aria-hidden
          />
          <div
            className="absolute inset-0 -m-4 rounded-full"
            style={{
              background: `radial-gradient(circle,rgba(${HITECH_GREEN_RGB},0.16),transparent 60%)`,
            }}
            aria-hidden
          />
          <WorkInProgressIcon className="relative h-[4.5rem] w-[4.5rem] sm:h-[5.5rem] sm:w-[5.5rem]" />
        </div>

        <div className="space-y-3">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#9B8CFF]/35 bg-[#9B8CFF]/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C4B8FF]">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: HITECH_GREEN,
                boxShadow: `0 0 8px ${HITECH_GREEN}`,
              }}
            />
            Work in progress
          </p>
          <h1 className="text-[2rem] font-semibold leading-[1.12] tracking-tight text-white sm:text-[2.65rem]">
            Technology, High-Tech and AI{" "}
            <span style={{ color: HITECH_GREEN }}>coming next</span>
          </h1>
          <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-[#97A2BA] sm:text-[16px]">
            SuperNova is live today for Biotech &amp; Medtech. The same catalyst desk — calendar,
            scored news, company Deep Dive — is being built for Technology, High-Tech and Artificial
            Intelligence. Use Contact on the home page to reach us.
          </p>
        </div>

        <div className="flex w-full max-w-md flex-col items-stretch gap-3 pt-2">
          <button
            type="button"
            className="rounded-xl border border-[#9B8CFF]/45 bg-[#9B8CFF]/10 px-5 py-2.5 text-[14px] font-semibold text-[#C4B8FF] transition-colors hover:bg-[#9B8CFF]/18"
            onClick={onBackBiotech}
          >
            Back to Biotech
          </button>
        </div>
      </div>
    </div>
  );
}
