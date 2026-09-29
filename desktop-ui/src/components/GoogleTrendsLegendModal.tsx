import { AppModal, AppModalCloseButton } from "./AppModal";

export function GoogleTrendsLegendModal({
  open,
  it,
  onClose,
}: {
  open: boolean;
  it: boolean;
  onClose: () => void;
}) {
  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-label={it ? "Legenda Google Trends" : "Google Trends legend"}
      panelClassName="w-[min(94vw,32rem)]"
    >
      <div className="card w-full max-h-[85vh] overflow-hidden shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
              {it ? "Legenda" : "Legend"}
            </p>
            <h3 className="text-sm font-bold text-ink mt-0.5">
              {it ? "Trend = Google Trends (ricerche web)" : "Trend = Google Trends (web search)"}
            </h3>
          </div>
          <AppModalCloseButton onClose={onClose} />
        </header>
        <div className="px-4 py-3 overflow-y-auto text-[12px] text-ink leading-snug space-y-2.5">
          <p>
            {it
              ? "Google Trends su ticker, nome della società e nome del prodotto (ricerche web negli USA). La riga principale è la variazione % giorno-su-giorno (finestra ~3 mesi). Sotto, se disponibile, c’è la lettura 24h (now 1-d). Indice a parte: non entra in Soft BUY/SELL."
              : "Google Trends on ticker, company name and product name (US web search). The main line is day-vs-day % change (~3-month window). Below, when available, is the 24h read (now 1-d). Separate index: not a Soft BUY/SELL gate."}
          </p>
          <p>
            {it
              ? "+27% = oggi si cerca il 27% in più rispetto all’ultima misura. −30% = il 30% in meno. = = stesso interesse. La riga «24h» confronta l’ultimo campione intraday con il precedente."
              : "+27% = 27% more searches than the last print. −30% = 30% fewer. = = same interest. The «24h» line compares the latest intraday sample to the previous one."}
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                {it ? "Verde + freccia su" : "Green + up arrow"}
              </span>
              {it
                ? " = % positiva: più ricerche della stampa precedente."
                : " = positive %: more searches than the previous print."}
            </li>
            <li>
              <span className="font-semibold text-rose-700 dark:text-rose-300">
                {it ? "Rosso + freccia giù" : "Red + down arrow"}
              </span>
              {it
                ? " = % negativa: meno ricerche della stampa precedente."
                : " = negative %: fewer searches than the previous print."}
            </li>
            <li>
              {it
                ? "La freccia si ingrossa mano a mano che cresce la |%| (in positivo o in negativo)."
                : "The arrow gets fatter as |%| grows (up or down)."}
            </li>
            <li>
              <span className="font-semibold">…</span>
              {it ? " = in caricamento. " : " = loading. "}
              <span className="font-semibold">—</span>
              {it ? " = nessun dato vivo." : " = no live print."}
            </li>
          </ul>
          <p className="text-ink-muted">
            {it
              ? "I numeri arrivano da Google Trends (due finestre: today 3-m + now 1-d). Poll 3× nei giorni di mercato (10:00, 16:00, 21:00 Roma), due volte nei festivi e weekend (11:30 e 17:00). Cache ~4 ore. Non sono un ordine e non sostituiscono volume o prezzo."
              : "Prints come from Google Trends (two windows: today 3-m + now 1-d). Three polls on market-open days (10:00, 16:00, 21:00 Rome), twice on holidays and weekends (11:30 and 17:00). Cache ~4 hours. They are not an order and they do not replace volume or price."}
          </p>
        </div>
      </div>
    </AppModal>
  );
}
