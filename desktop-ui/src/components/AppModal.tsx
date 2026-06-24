import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../shared/i18n";

export function AppModal({
  open,
  onClose,
  children,
  align = "center",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  panelClassName = "",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "center" | "end";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  panelClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const shellClass =
    align === "end"
      ? "fixed inset-0 z-[100] flex justify-end"
      : "fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4";

  return createPortal(
    <div
      className={shellClass}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div
        className={`relative z-10 max-h-[94vh] ${panelClassName}`.trim()}
        onMouseDown={(e) => e.stopPropagation()}
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
      className={`shrink-0 rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-[rgb(var(--surface-3))] hover:text-ink ${className}`.trim()}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      aria-label={t("common.close")}
    >
      ✕
    </button>
  );
}
