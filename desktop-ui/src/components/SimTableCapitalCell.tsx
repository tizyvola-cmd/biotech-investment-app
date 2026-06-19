import { CapitalNumberInput } from "./CapitalNumberInput";
import type { SynthCapitalSyncEntry } from "../sheet/synthCapitalSyncLog";

type Props = {
  inPortfolio: boolean;
  capital: number;
  synthCapEur: number | null;
  placeholder?: string;
  lang: "it" | "en";
  inputClassName: string;
  wrapperClassName?: string;
  onCommit: (value: number) => void;
  onSyncToSynth: () => void;
  syncEntries: SynthCapitalSyncEntry[];
  logExpanded: boolean;
  onToggleLog: () => void;
};

function fmtEur(v: number, locale: string): string {
  return `${Math.round(v).toLocaleString(locale)} €`;
}

function fmtWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SimTableCapitalCell({
  inPortfolio,
  capital,
  synthCapEur,
  placeholder,
  lang,
  inputClassName,
  wrapperClassName = "flex flex-col gap-0.5 min-w-0 items-center w-full",
  onCommit,
  onSyncToSynth,
  syncEntries,
  logExpanded,
  onToggleLog,
}: Props) {
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";
  const roundedCap = Math.round(capital > 0 ? capital : 0);
  const roundedSynth = synthCapEur != null ? Math.round(synthCapEur) : null;
  const needsSync =
    inPortfolio &&
    roundedSynth != null &&
    roundedCap !== roundedSynth;
  const showSynthActions = inPortfolio && synthCapEur != null;
  const isTrimToDust = roundedSynth != null && roundedSynth <= 80 && roundedCap > roundedSynth;

  return (
    <div className={wrapperClassName}>
      <CapitalNumberInput
        className={inputClassName}
        value={capital > 0 ? capital : 0}
        placeholder={placeholder}
        onCommit={onCommit}
      />
      {showSynthActions ? (
        <div className="w-full min-w-0 flex flex-col gap-0.5">
          <button
            type="button"
            className={`w-full rounded px-1 py-0.5 text-[9px] font-semibold leading-tight tabular-nums transition ${
              needsSync
                ? isTrimToDust
                  ? "border border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-100 hover:bg-amber-500/25"
                  : "border border-teal-500/45 bg-teal-500/12 text-teal-800 dark:text-teal-200 hover:bg-teal-500/20"
                : "border border-[rgb(var(--border))]/40 bg-surface/40 text-ink-muted hover:bg-surface/70"
            }`}
            title={
              isTrimToDust
                ? it
                  ? `Riduci esposizione verso ${fmtEur(roundedSynth!, locale)} (synth quasi zero)`
                  : `Trim exposure toward ${fmtEur(roundedSynth!, locale)} (synth near zero)`
                : it
                  ? `Allinea capitale al synth suggerito (${fmtEur(roundedSynth!, locale)})`
                  : `Align capital to suggested synth (${fmtEur(roundedSynth!, locale)})`
            }
            onClick={onSyncToSynth}
          >
            {needsSync
              ? isTrimToDust
                ? it
                  ? `↘ Trim ${fmtEur(roundedSynth!, locale)}`
                  : `↘ Trim ${fmtEur(roundedSynth!, locale)}`
                : it
                  ? `→ Synth ${fmtEur(roundedSynth!, locale)}`
                  : `→ Synth ${fmtEur(roundedSynth!, locale)}`
              : it
                ? "✓ Allineato synth"
                : "✓ Synth aligned"}
          </button>
          <button
            type="button"
            className="w-full text-[9px] leading-tight text-[rgb(var(--accent))]/85 hover:text-[rgb(var(--accent))] tabular-nums truncate"
            title={
              it
                ? "Mostra storico aggiornamenti capitale da synth"
                : "Show capital updates driven by synth"
            }
            onClick={onToggleLog}
          >
            {logExpanded ? "▾" : "▸"}{" "}
            {it ? "Storico synth" : "Synth history"}
            {syncEntries.length > 0 ? ` (${syncEntries.length})` : ""}
          </button>
          {logExpanded ? (
            <div className="max-h-24 overflow-y-auto rounded border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))]/80">
              {syncEntries.length === 0 ? (
                <p className="px-1.5 py-1 text-[9px] text-ink-muted leading-snug">
                  {it
                    ? "Nessun aggiornamento. Usa → Synth per allineare."
                    : "No updates yet. Use → Synth to align."}
                </p>
              ) : (
                <table className="w-full text-[9px] tabular-nums">
                  <thead>
                    <tr className="text-ink-muted border-b border-[rgb(var(--border))]/50">
                      <th className="text-left font-semibold px-1 py-0.5">{it ? "Quando" : "When"}</th>
                      <th className="text-right font-semibold px-1 py-0.5">{it ? "Da" : "From"}</th>
                      <th className="text-right font-semibold px-1 py-0.5">{it ? "A" : "To"}</th>
                      <th className="text-right font-semibold px-1 py-0.5">Synth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncEntries.map((e) => (
                      <tr
                        key={`${e.at}-${e.fromCapitalEur}-${e.toCapitalEur}-${e.source ?? "auto"}`}
                        className="border-b border-[rgb(var(--border))]/30 last:border-0"
                      >
                        <td className="px-1 py-0.5 text-left whitespace-nowrap">{fmtWhen(e.at, locale)}</td>
                        <td className="px-1 py-0.5 text-right">{fmtEur(e.fromCapitalEur, locale)}</td>
                        <td className="px-1 py-0.5 text-right font-semibold text-[rgb(var(--accent))]">
                          {fmtEur(e.toCapitalEur, locale)}
                        </td>
                        <td
                          className="px-1 py-0.5 text-right text-ink-muted"
                          title={fmtEur(e.synthEur, locale)}
                        >
                          {e.synthSharePct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
