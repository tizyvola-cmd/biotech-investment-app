import { AppModal, AppModalCloseButton } from "./AppModal";

type Col = {
  id: string;
  title: { it: string; en: string };
  what: { it: string; en: string };
  impact: { it: string; en: string };
  gate: boolean;
};

const COLS: Col[] = [
  {
    id: "ticker",
    title: { it: "Ticker", en: "Ticker" },
    what: {
      it: "Il simbolo Nasdaq del titolo. Un titolo può comparire in più righe se ha più di un evento. Cliccalo per aprire il dossier KPI completo.",
      en: "The stock's Nasdaq symbol. One stock can appear in several rows if it has more than one event. Click it to open the full KPI dossier.",
    },
    impact: {
      it: "Il ticker da solo non ti dice nulla — è solo la porta d'ingresso per confrontare questo evento con tutto il resto del book.",
      en: "The ticker alone tells you nothing — it's just the door into comparing this event against everything else in the book.",
    },
    gate: false,
  },
  {
    id: "event",
    title: { it: "Event", en: "Event" },
    what: {
      it: "Cosa sta succedendo: BUY (Soft BUY senza catalyst entro 10 giorni), AdCom, PDUFA, Readout, CD, Filing, ASCO, ecc.",
      en: "What's happening: BUY (Soft BUY with no catalyst inside 10 days), AdCom, PDUFA, Readout, CD, Filing, ASCO, etc.",
    },
    impact: {
      it: "Un evento binario come un AdCom o un PDUFA muove il titolo molto più di un update di routine. Chiediti: il mercato può davvero essere sorpreso qui?",
      en: "A binary event like an AdCom or PDUFA moves the stock far more than a routine update. Ask yourself: can the market actually be surprised here?",
    },
    gate: false,
  },
  {
    id: "days",
    title: { it: "Days", en: "Days" },
    what: {
      it: "Giorni che mancano all'evento (0 = oggi). Più si avvicina, più tendono a muoversi opzioni, volume e Trends.",
      en: "Days left until the event (0 = today). The closer it gets, the more options, volume, and Trends tend to move.",
    },
    impact: {
      it: "A 1–2 giorni la tua tesi deve essere già pronta. A 8–10 giorni hai ancora tempo per fare ricerca, costruire una posizione o guardare le opzioni.",
      en: "At 1–2 days, your thesis needs to be ready. At 8–10 days, you still have time to research, build a position, or look at options.",
    },
    gate: false,
  },
  {
    id: "bias",
    title: { it: "Momentum", en: "Momentum" },
    what: {
      it: "Una lettura direzionale che combina RR, divergenza prezzo/volume, acquisti Insider e performance vs XBI. Sopra +0,3 = rialzista, sotto −0,3 = timoroso.",
      en: "A directional read combining RR, price/volume divergence, Insider buying, and performance vs XBI. Above +0.3 = bullish, below −0.3 = fearful.",
    },
    impact: {
      it: "Mostra se i segnali sono d'accordo. Non forzare un BUY solo perché Momentum è verde se Rec dice ancora HOLD.",
      en: "Shows whether the signals agree. Don't force a BUY just because Momentum is green if Rec still says HOLD.",
    },
    gate: false,
  },
  {
    id: "trends",
    title: { it: "G-Trends", en: "G-Trends" },
    what: {
      it: "Interesse di ricerca Google per ticker/prodotto negli USA — variazione % giorno su giorno su ~3 mesi. Verde = più ricerche, rosso = meno.",
      en: "Google search interest for the ticker/product in the US — day-over-day % change over ~3 months. Green = more searches, red = fewer.",
    },
    impact: {
      it: "Un picco prima di un AdCom/PDUFA significa che sta arrivando l'attenzione del pubblico — di solito dopo che lo smart money si è già mosso. Da solo non basta per comprare.",
      en: "A spike before an AdCom/PDUFA means public attention is arriving — usually after smart money has already moved. Not enough on its own to buy.",
    },
    gate: false,
  },
  {
    id: "vol",
    title: { it: "Volume", en: "Volume" },
    what: {
      it: "Azioni scambiate rispetto all'ultima seduta chiusa. Verde = più scambi, rosso = meno. È solo quantità, non direzione.",
      en: "Shares traded vs the last closed session. Green = more trading, red = less. This is quantity only, not direction.",
    },
    impact: {
      it: "Volume alto + prezzo in salita = interesse d'acquisto reale. Volume alto + prezzo in discesa = vendite/distribuzione. Volume basso = ancora nessun consenso.",
      en: "High volume + rising price = real buying interest. High volume + falling price = selling/distribution. Low volume = no consensus yet.",
    },
    gate: false,
  },
  {
    id: "conviction",
    title: { it: "Conviction", en: "Conviction" },
    what: {
      it: "Confronta la direzione del prezzo con la direzione del volume. «Together» = sono d'accordo. «Diverge» = non lo sono.",
      en: "Compares price direction with volume direction. \"Together\" = they agree. \"Diverge\" = they don't.",
    },
    impact: {
      it: "La divergenza è un segnale d'allarme — se avviene prima del catalyst, aspetta conferma da Trends/Sentiment/Rec prima di agire.",
      en: "Divergence is a warning sign — if it happens before the catalyst, wait for Trends/Sentiment/Rec to confirm before acting.",
    },
    gate: false,
  },
  {
    id: "sentiment",
    title: { it: "Sentiment (IVR)", en: "Sentiment (IVR)" },
    what: {
      it: "Volatilità implicita della scadenza dell'evento, divisa per la volatilità implicita di una scadenza normale. In salita = il mercato si aspetta un movimento più grande. EM = costo di uno straddle at-the-money, in % del prezzo.",
      en: "Implied volatility for the event's expiry, divided by implied volatility for a normal expiry. Rising = the market expects a bigger move. EM = cost of an at-the-money straddle, as % of price.",
    },
    impact: {
      it: "Non dice se sale o scende — solo quanto violento sarà il movimento atteso. Un Sentiment in salita rende la copertura più cara; conviene solo se riesci a sostenere lo scossone.",
      en: "This doesn't say up or down — only how violent the move is expected to be. Rising Sentiment makes hedging pricier; only worth it if you can handle the swing.",
    },
    gate: false,
  },
  {
    id: "skew",
    title: { it: "Skew", en: "Skew" },
    what: {
      it: "Il divario tra i prezzi delle call e quelli delle put. RR = IV call a +10% meno IV put a −10%. PCR = volume put ÷ volume call.",
      en: "The gap between call prices and put prices. RR = call IV at +10% minus put IV at −10%. PCR = put volume ÷ call volume.",
    },
    impact: {
      it: "Call care (rosso) = il mercato sta già prezzando l'upside. Put care (verde) = paura, quindi un esito positivo può far male ancora di più agli short. Pensalo come un termometro del posizionamento.",
      en: "Expensive calls (red) = the market is already pricing in the upside. Expensive puts (green) = fear, so a good outcome can hurt shorts even more. Think of it as a positioning thermometer.",
    },
    gate: false,
  },
  {
    id: "short",
    title: { it: "Short Δ", en: "Short Δ" },
    what: {
      it: "Variazione dello short interest rispetto all'ultimo report (FINRA/Yahoo, pubblicato due volte al mese). In su = i ribassisti aumentano. In giù = i ribassisti stanno coprendo.",
      en: "Change in short interest vs the last report (FINRA/Yahoo, published twice a month). Up = bears adding. Down = bears covering.",
    },
    impact: {
      it: "Short interest in calo + catalyst positivo = meno pressione in vendita, short che chiudono. Short interest in crescita = ribassisti più convinti. Nessuno dei due è di per sé un segnale automatico di acquisto o vendita.",
      en: "Falling short interest + a positive catalyst = less selling pressure, shorts closing out. Rising short interest = bears more convinced. Neither is an automatic buy or sell signal alone.",
    },
    gate: false,
  },
  {
    id: "vs_xbi",
    title: { it: "vs XBI", en: "vs XBI" },
    what: {
      it: "Rendimento a 5 giorni del titolo meno il rendimento del settore biotech (XBI) — una beta semplificata.",
      en: "The stock's 5-day return minus the biotech sector's (XBI) return — a simplified beta.",
    },
    impact: {
      it: "Separa l'entusiasmo reale su questo titolo da un rally che è solo tutto il settore che si muove. La sovraperformance suggerisce interesse specifico sul nome; seguire il settore non è una tesi in sé.",
      en: "Separates real excitement about this stock from a rally that's just the whole sector moving. Outperformance suggests name-specific interest; tracking the sector isn't a thesis on its own.",
    },
    gate: false,
  },
  {
    id: "d1h",
    title: { it: "Δ visit", en: "Δ visit" },
    what: {
      it: "Variazione % del prezzo rispetto all’ultima call oraria del Catalyst desk (pack ~1 ora).",
      en: "Percent price change vs the Catalyst desk’s previous hourly call (~1h pack).",
    },
    impact: {
      it: "Micro-move tra un refresh e l’altro — complementary a Δ24h. Non è Soft BUY/SELL.",
      en: "Micro-move between refreshes — complementary to Δ24h. Not Soft BUY/SELL.",
    },
    gate: false,
  },
  {
    id: "d24",
    title: { it: "Δ24h", en: "Δ24h" },
    what: {
      it: "Variazione % del prezzo sulla sessione ~24h (Var. Giorn. Simulation / ultima sessione).",
      en: "Percent price change over the ~24h session (Simulation daily % / last session).",
    },
    impact: {
      it: "Mostra se il titolo si sta già muovendo prima dell’evento. Incrocia con Last Order e vs XBI — non è Soft BUY/SELL.",
      en: "Shows whether the name is already moving into the event. Cross-check with Last Order and vs XBI — not Soft BUY/SELL.",
    },
    gate: false,
  },
  {
    id: "premkt",
    title: { it: "Last Order", en: "Last Order" },
    what: {
      it: "Un proxy gratuito dello sbilanciamento degli ordini: prezzo e volume pre-market (4:00–9:30 ET). «Together» = prezzo e volume si confermano. «Diverge» = il movimento sembra debole.",
      en: "A free proxy for order imbalance: pre-market price and volume (4:00–9:30 ET). \"Together\" = price and volume confirm each other. \"Diverge\" = the move looks weak.",
    },
    impact: {
      it: "Un primo check gratuito su come aprirà il titolo. Se concorda con il Search Buzz la lettura è più forte — da solo è solo un indizio, non una prova.",
      en: "A free first check on how the stock will open. If it agrees with Search Buzz, the read is stronger — on its own it's just a hint, not proof.",
    },
    gate: false,
  },
  {
    id: "insider",
    title: { it: "Insider", en: "Insider" },
    what: {
      it: "Traccia lo «smart money»: Form 4 (dirigenti che comprano con i propri soldi), 13D (un attivista che supera il 5% di proprietà), 13G (un istituzionale che costruisce una quota passiva sopra il 5%). Le vendite di routine 10b5-1 sono escluse.",
      en: "Tracks \"smart money\": Form 4 (executives buying with their own money), 13D (an activist crossing 5% ownership), 13G (an institution building a passive stake above 5%). Routine 10b5-1 sales are excluded.",
    },
    impact: {
      it: "Chi è vicino all'azienda e compra con i propri soldi prima di un catalyst può sapere qualcosa che tu non sai. Trattalo come un segnale precoce e incrocialo con Rec e con il tipo di evento.",
      en: "Someone close to the company buying with their own money before a catalyst may know something you don't. Treat it as an early signal, and cross-check against Rec and the event type.",
    },
    gate: false,
  },
  {
    id: "exec_exit",
    title: { it: "Exec Exit", en: "Exec Exit" },
    what: {
      it: "Uscite e nuove nomine di dirigenti o membri del board negli ultimi ~60 giorni, con il ruolo indicato (CEO Left, CMO Left, New CFO, ecc.).",
      en: "Executive or board departures and new appointments in the last ~60 days, with the role shown (CEO Left, CMO Left, New CFO, etc.).",
    },
    impact: {
      it: "Un CMO o un CEO che se ne va proprio prima di un evento binario è un motivo per ridurre la posizione o restare fuori — anche se Insider sembra positivo.",
      en: "A CMO or CEO leaving right before a binary event is a reason to cut your position or stay out — even if Insider looks positive.",
    },
    gate: false,
  },
  {
    id: "fda_brief",
    title: { it: "FDA Brief", en: "FDA Brief" },
    what: {
      it: "Score o «File» quando i materiali AdCom sono pubblicati. Link briefing e summary nella finestra Event (niente countdown T−2 in colonna).",
      en: "Score or \"File\" when AdCom materials are published. Briefing link and summary live in the Event window (no T−2 countdown in the column).",
    },
    impact: {
      it: "Spesso è il primo testo ufficiale che muove il titolo. Uno score debole a T−2 è un motivo per ridurre, non per raddoppiare — ma non predice il voto effettivo del comitato.",
      en: "Often the first official text that moves the stock. A weak score at T−2 is a reason to cut, not double down — but it doesn't predict the committee's actual vote.",
    },
    gate: false,
  },
  {
    id: "rec",
    title: { it: "Rec", en: "Rec" },
    what: {
      it: "Soft BUY / SELL / HOLD / REVIEW direttamente dal motore — le stesse regole usate da Pulse e dal dossier Top KPI. Questa colonna non calcola nulla di nuovo: mostra ciò che il motore ha già deciso.",
      en: "Soft BUY / SELL / HOLD / REVIEW straight from the engine — the same rules used by Pulse and the Top KPI dossier. This column doesn't calculate anything new; it shows what the engine already decided.",
    },
    impact: {
      it: "È l'unica colonna legata a regole operative reali. Tutto il resto (Trends, IV, Short Interest…) è contesto. Non farti convincere da uno Skew verde a fare un BUY quando questa colonna dice HOLD.",
      en: "The only column tied to real trading rules. Everything else (Trends, IV, Short Interest…) is context. Don't let a green Skew talk you into a BUY when this column says HOLD.",
    },
    gate: true,
  },
];

export function CatalystFullLegendModal({
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
      aria-label={it ? "Legenda completa colonne Catalyst" : "Full Catalyst columns legend"}
      panelClassName="w-[min(96vw,52rem)]"
    >
      <div className="card w-full max-h-[88vh] overflow-hidden shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
              Catalyst Days
            </p>
            <h3 className="text-sm font-bold text-ink mt-0.5">
              {it ? "Legenda colonne" : "Columns legend"}
            </h3>
            <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">
              {it
                ? "Ogni colonna è un indice a parte (non entra in Soft BUY/SELL), tranne Rec che mostra i gate operativi."
                : "Each column is a separate index (not a Soft BUY/SELL gate), except Rec which shows the operational gates."}
            </p>
          </div>
          <AppModalCloseButton onClose={onClose} />
        </header>

        <div className="overflow-y-auto flex-1 min-h-0">
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 z-[1] bg-[rgb(var(--surface))]">
              <tr className="text-left text-[9px] uppercase tracking-wide text-ink-muted border-b border-[rgb(var(--border))]/50">
                <th className="px-4 py-2 w-[7rem]">
                  {it ? "Colonna" : "Column"}
                </th>
                <th className="px-3 py-2">
                  {it ? "Cosa significa" : "What it means"}
                </th>
                <th className="px-3 py-2">
                  {it ? "Perché conta" : "Why it matters"}
                </th>
              </tr>
            </thead>
            <tbody>
              {COLS.map((col) => (
                <tr
                  key={col.id}
                  className={`border-b border-[rgb(var(--border))]/25 ${
                    col.gate
                      ? "bg-emerald-50/60 dark:bg-emerald-900/10"
                      : ""
                  }`}
                >
                  <td className="px-4 py-2 align-top font-semibold text-ink whitespace-nowrap">
                    {it ? col.title.it : col.title.en}
                    {col.gate ? (
                      <span className="ml-1 text-[8px] text-emerald-700 dark:text-emerald-300 font-bold uppercase">
                        gate
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-ink leading-snug">
                    {it ? col.what.it : col.what.en}
                  </td>
                  <td className="px-3 py-2 align-top text-ink-muted leading-snug">
                    {it ? col.impact.it : col.impact.en}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="px-4 py-2.5 border-t border-[rgb(var(--border))]/40 shrink-0">
          <p className="text-[9px] text-ink-muted leading-snug">
            {it
              ? "Ctrl+clic su un'intestazione apre la legenda dettagliata di quella singola colonna."
              : "Ctrl+click on a column header opens the detailed legend for that single column."}
          </p>
        </footer>
      </div>
    </AppModal>
  );
}
