import { isMedtechTicker } from "../medtechSymbols";

function DeviceEcgIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="study-type-icon">
      <rect x="1.5" y="2" width="13" height="10.5" rx="1.8" fill="#0d9488" />
      <rect x="2.2" y="2.7" width="11.6" height="7.2" rx="1" fill="#134e4a" />
      <polyline
        points="3,7.2 4.6,7.2 5.2,4.8 6.1,9.6 7.2,5.8 8.3,7.2 9.4,7.2 10.2,6.2 11,7.2 12.6,7.2"
        fill="none"
        stroke="#5eead4"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StudyTypeIcon({ ticker, size = 14 }: { ticker: string; size?: number }) {
  if (!isMedtechTicker(ticker)) return null;
  return (
    <span className="study-type-icon-wrap" title="MedTech / device">
      <DeviceEcgIcon size={size} />
    </span>
  );
}
