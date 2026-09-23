import { useCallback, useState, type ReactNode } from "react";

function readPref(key: string, defaultOpen: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore */
  }
  return defaultOpen;
}

function writePref(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

type Props = {
  id: string;
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

/** Home dashboard fold — persists open/closed in localStorage. */
export function DashboardCollapsibleSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
  className,
}: Props) {
  const storageKey = `dashboard_section_${id}_v1`;
  const [open, setOpen] = useState(() => readPref(storageKey, defaultOpen));
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      writePref(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return (
    <section
      className={`shrink-0 min-w-0 rounded-xl border border-[rgb(var(--border))]/45 bg-surface/25 overflow-hidden ${className ?? ""}`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[rgb(var(--accent))]/5 transition-colors"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden
          className={`shrink-0 text-ink-muted transition-transform ${open ? "" : "-rotate-90"}`}
        >
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-xs font-semibold text-ink">{title}</span>
        {!open && summary ? (
          <span className="ml-auto text-[10px] text-ink-muted truncate max-w-[min(100%,28rem)]">
            {summary}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={`${id}-body`} className="border-t border-[rgb(var(--border))]/35 px-1 pb-1 pt-0.5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
