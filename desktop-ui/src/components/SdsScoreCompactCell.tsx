import type { SdsGateInfo } from "../sheet/sdsTopOppGate";
import { useT } from "../shared/i18n";
import { SdsScorePie } from "./SdsScorePie";

export function SdsScoreCompactCell({
  info,
  onOpenSupernova,
  size = 36,
}: {
  info: SdsGateInfo | null | undefined;
  /** Apre Decision Lab → tab SuperNova (opz. con ticker in evidenza). */
  onOpenSupernova?: () => void;
  /** @deprecated Il link è sulla torta; non mostrare più testo SuperNova. */
  linkLabel?: string;
  size?: number;
}) {
  const t = useT();

  if (!info || !Number.isFinite(info.sds)) {
    return (
      <div className="sds-score-compact-cell flex items-center justify-center w-full min-h-[2.35rem]">
        <span className="text-ink-muted text-[10px] tabular-nums">—</span>
      </div>
    );
  }

  const tip = [
    `SDS ${info.sds.toFixed(1)}`,
    info.zone_label,
    info.veto ? `Veto: ${info.veto}` : null,
    info.missing_data_pct != null ? `Missing ${info.missing_data_pct.toFixed(0)}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const openTitle = onOpenSupernova ? t("sim.workspace.openSupernovaShort") : undefined;
  const pieTitle = openTitle ? `${tip} — ${openTitle}` : tip;

  return (
    <div className="sds-score-compact-cell flex flex-col items-center justify-center w-full min-h-[2.35rem] gap-0.5">
      <SdsScorePie
        score={info.sds}
        size={size}
        onClick={onOpenSupernova}
        title={pieTitle}
      />
      {info.veto ? (
        <span
          className="text-[7px] font-bold uppercase tracking-wide text-[rgb(var(--warn))] leading-none"
          title={info.veto}
        >
          veto
        </span>
      ) : null}
    </div>
  );
}
