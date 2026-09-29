/**
 * Top vertical strip under SuperNova — Biotech (marine) + Technology/AI (aqua #0efdc8).
 * Plain text for Technology (no pill / round frame).
 */
import { useLang } from "../shared/i18n";
import { BIOTECH_MARINE, HITECH_GREEN } from "./hitechAccent";

export type PlatformId = "pharma" | "hitech";

export function PlatformRail({
  active = "pharma",
  onSelect,
}: {
  active?: PlatformId;
  onSelect?: (id: PlatformId) => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  return (
    <div
      className="platform-rail relative z-[65] flex h-8 shrink-0 items-center gap-2.5 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--bg-deep))] px-2 sm:px-3"
      role="navigation"
      aria-label={it ? "Verticale SuperNova" : "SuperNova vertical"}
    >
      <button
        type="button"
        className={`px-1.5 py-1 text-[11px] font-semibold tracking-wide transition-opacity hover:opacity-100 ${
          active === "pharma" ? "opacity-100" : "opacity-70"
        }`}
        style={{ color: BIOTECH_MARINE }}
        aria-current={active === "pharma" ? "page" : undefined}
        onClick={() => onSelect?.("pharma")}
        title={it ? "Biotech/Medtech" : "Biotech/Medtech"}
      >
        Biotech/Medtech
      </button>

      <button
        type="button"
        className={`px-1.5 py-1 text-[11px] font-semibold tracking-wide transition-opacity hover:opacity-100 ${
          active === "hitech" ? "opacity-100" : "opacity-70"
        }`}
        style={{ color: HITECH_GREEN }}
        aria-current={active === "hitech" ? "page" : undefined}
        onClick={() => onSelect?.("hitech")}
        title={it ? "Technology/AI — in arrivo" : "Technology/AI — coming soon"}
      >
        Technology/AI
      </button>
    </div>
  );
}
