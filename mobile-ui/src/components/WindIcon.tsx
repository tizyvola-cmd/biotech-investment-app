/** Same wind glyph as desktop ContG10Badge / Pulse P(cont). */
export function WindIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "dash-wind-svg"}
      aria-hidden
    >
      <path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </svg>
  );
}
