import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../shared/i18n";

/** Ignore backdrop close right after open — prevents open-button click from instant-dismiss. */
const BACKDROP_CLOSE_GUARD_MS = 350;
/** After close, swallow the same-gesture click so the opener underneath cannot reopen. */
const CLICK_THROUGH_GUARD_MS = 200;

function guardClickThrough() {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener("click", swallow, true);
  document.addEventListener("pointerup", swallow, true);
  window.setTimeout(() => {
    document.removeEventListener("click", swallow, true);
    document.removeEventListener("pointerup", swallow, true);
  }, CLICK_THROUGH_GUARD_MS);
}

export function AppModal({
  open,
  onClose,
  children,
  align = "center",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  panelClassName = "",
  zIndexClass = "z-[9999]",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "center" | "end";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  panelClassName?: string;
  /** Stack order — default above dashboard overlays (notification bell, toasts). */
  zIndexClass?: string;
}) {
  const openedAtRef = useRef(0);
  const wasOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Stamp open time during render so the first backdrop click cannot instant-dismiss. */
  if (open && !wasOpenRef.current) {
    openedAtRef.current = performance.now();
  }
  wasOpenRef.current = open;

  const safeClose = () => {
    onCloseRef.current();
    guardClickThrough();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Side Detail dock owns Escape while open — leave the parent modal alone.
      if (document.documentElement.dataset.eisDetailDock === "1") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      safeClose();
    };
    window.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close via ref
  }, [open]);

  const handleBackdropClose = () => {
    if (performance.now() - openedAtRef.current < BACKDROP_CLOSE_GUARD_MS) return;
    safeClose();
  };

  if (!open || typeof document === "undefined") return null;

  const shellClass =
    align === "end"
      ? `fixed inset-0 ${zIndexClass} flex items-stretch justify-end overflow-hidden`
      : `fixed inset-0 ${zIndexClass} flex items-center justify-center overflow-hidden p-3 sm:p-4`;

  return createPortal(
    <div
      className={shellClass}
      data-app-modal-align={align}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleBackdropClose();
        }}
        onWheel={(e) => e.preventDefault()}
      />
      <div
        className={`relative z-10 max-h-[94vh] min-h-0 overflow-hidden overscroll-contain pointer-events-auto ${panelClassName}`.trim()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function AppModalCloseButton({
  onClose,
  className = "",
}: {
  onClose: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={`relative z-20 shrink-0 rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-[rgb(var(--surface-3))] hover:text-ink pointer-events-auto ${className}`.trim()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        guardClickThrough();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      aria-label={t("common.close")}
    >
      ✕
    </button>
  );
}
