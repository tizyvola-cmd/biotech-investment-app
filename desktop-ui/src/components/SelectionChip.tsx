import type { ButtonHTMLAttributes, ReactNode } from "react";

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  active?: boolean;
  children: ReactNode;
};

/** Outline pill for filters, presets, and single/multi-select toggles. */
export function SelectionChip({
  active = false,
  children,
  className = "",
  disabled,
  ...rest
}: ChipProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${active ? "chip-btn-active" : "chip-btn"} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SelectionChipGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`flex flex-wrap gap-1 ${className}`.trim()}>{children}</div>;
}
