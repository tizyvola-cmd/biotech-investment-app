/** Orologio antico per refresh domenica full (distinto dalla clessidra del daily). */



export function AntiqueClockIcon({

  size = 18,

  className = "",

  ticking = true,

}: {

  size?: number;

  className?: string;

  ticking?: boolean;

}) {

  return (

    <span

      className={`inline-flex items-center justify-center leading-none select-none ${className}`.trim()}

      style={{ width: size, height: size }}

      aria-hidden

      title="Sunday full refresh"

    >

      <span

        className={`relative inline-block ${ticking ? "animate-clock-tick" : ""}`}

        style={{ fontSize: Math.round(size * 0.95) }}

      >

        🕰️

      </span>

    </span>

  );

}

