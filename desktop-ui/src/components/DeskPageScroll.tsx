/**
 * Shared full-viewport shell for Catalyst Days and Deep Dive.
 * - overflow="auto" (default): page owns the scrollbar (Deep Dive / Discovery).
 * - overflow="hidden": flex pin + fill — last child grows to the bottom edge.
 */
import type { ReactNode } from "react";

export function DeskPageScroll({
  children,
  className = "",
  "data-page": dataPage,
  overflow = "auto",
}: {
  children: ReactNode;
  className?: string;
  "data-page"?: string;
  overflow?: "auto" | "hidden";
}) {
  const fillHidden = overflow === "hidden";
  return (
    <div
      data-page={dataPage}
      className={`desk-page-scroll absolute inset-0 min-h-0 overscroll-contain bg-[rgb(var(--bg-deep))] ${
        fillHidden
          ? "overflow-hidden overflow-x-clip flex flex-col max-w-full"
          : "overflow-y-auto overflow-x-clip flex flex-col max-w-full"
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}
