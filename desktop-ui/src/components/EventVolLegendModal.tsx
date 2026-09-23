import { AppModal, AppModalCloseButton } from "./AppModal";

export type CatalystLegendTopic =
  | "ticker"
  | "productDesig"
  | "newsScores"
  | "event"
  | "day"
  | "trends"
  | "vol"
  | "diverge"
  | "ivr"
  | "skew"
  | "short"
  | "rec"
  | "bias"
  | "accum"
  | "gov"
  | "silent"
  | "vsxbi"
  | "d1h"
  | "d24"
  | "preopen"
  | "premkt"
  | "uoa"
  | "fda";

/** @deprecated use CatalystLegendTopic — kept so existing IVR/Skew imports still type-check. */
export type EventVolLegendTopic = CatalystLegendTopic;

type LegendCopy = {
  title: { it: string; en: string };
  paras: { it: string; en: string }[];
};

const LEGENDS: Record<CatalystLegendTopic, LegendCopy> = {
  ticker: {
    title: { it: "Ticker", en: "Ticker" },
    paras: [
      {
        it: "Il simbolo Nasdaq del titolo. Un titolo può avere più eventi (Guidance, FDA…), quindi può comparire su più di una riga.",
        en: "The stock's Nasdaq symbol. One stock can have several events (Guidance, FDA...), so it can appear in more than one row.",
      },
      {
        it: "Clicca il ticker per andare alla riga Top KPI di quel titolo (evidenziata in giallo). Da lì vedi capitale, Rec e il profilo completo.",
        en: "Click the ticker to jump to that stock's Top KPI row (highlighted in yellow). From there you see capital, Rec, and the full profile.",
      },
      {
        it: "Per investire: il ticker da solo non è un segnale. È il punto di ingresso per aprire il dossier e confrontare questo evento con il resto del book.",
        en: "For investing: the ticker alone isn't a signal. It's your entry point to open the dossier and compare this event against the rest of the book.",
      },
    ],
  },
  productDesig: {
    title: { it: "Prodotto · Designation", en: "Product · Designation" },
    paras: [
      {
        it: "Nome del prodotto/candidato (riga sopra) e designazioni FDA (sotto): Orphan, Fast Track, Breakthrough, Rare Pediatric, RMAT… Fonti: Discovery, ricerca FDA.gov e Daily News della società.",
        en: "Product/candidate name (top line) and FDA designations (below): Orphan, Fast Track, Breakthrough, Rare Pediatric, RMAT… Sources: Discovery, FDA.gov product search, and company Daily News.",
      },
      {
        it: "Una designation non è un segnale di trading: indica priorità regolatoria e spesso un percorso più corto. Controlla se è sul prodotto del catalyst in riga.",
        en: "A designation is not a trading signal: it marks regulatory priority and often a shorter path. Check it matches the catalyst product on that row.",
      },
    ],
  },
  newsScores: {
    title: { it: "Daily Score", en: "Daily Score" },
    paras: [
      {
        it: "Score Clin / Fin / Soc / Acc: sommatoria delle ultime 36 ore (Daily News + Deep Dive). Dimensioni indipendenti — ciascuna misura quanto un evento fa avanzare o arretrare quel fronte.",
        en: "Clin / Fin / Corp / Acc: sum over the last 36 hours (Daily News + Deep Dive). Independent dimensions — each tracks how much an event advances or sets back that front.",
      },
      {
        it: "Daily News riempie i buchi dove Deep Dive non ha ancora uno score sulla stessa gamba. EIS di mercato resta per-evento, non sommato qui.",
        en: "Daily News fills gaps where Deep Dive has no score on that leg yet. Market EIS stays per-event — not summed here.",
      },
    ],
  },
  event: {
    title: { it: "Evento", en: "Event" },
    paras: [
      {
        it: "I CD (Catalyst Days) marcano eventi e milestone aziendali attesi a innescare una reazione di mercato.",
        en: "CD (Catalyst Days) mark events and company milestones expected to trigger a market reaction.",
      },
      {
        it: "Un evento binario (AdCom / PDUFA) muove il titolo più di un update intermedio o di un CD lontano. Le righe BUY servono a leggere Trends/Vol/Expectation sul gruppo Soft BUY.",
        en: "A binary event (AdCom / PDUFA) moves the stock more than an interim update or a distant CD. BUY rows let you scan Trends/Vol/Expectation on the Soft BUY group.",
      },
      {
        it: "Per investire: chiediti se il mercato può davvero essere sorpreso. Un AdCom o un PDUFA sul prodotto principale conta più di un CD su un asset secondario.",
        en: "For investing: ask whether the market can actually be surprised. An AdCom or PDUFA on the lead product matters more than a CD on a secondary asset.",
      },
    ],
  },
  day: {
    title: { it: "Giorni rimasti", en: "Days Left" },
    paras: [
      {
        it: "Giorni all'evento (es. 19g, 1g, 0g = oggi). I catalyst coprono i prossimi 20 giorni; le Soft BUY senza catalyst vicino mostrano i giorni al CD (anche oltre 20).",
        en: "Days until the event (e.g. 19d, 1d, 0d = today). Catalysts cover the next 20 days; Soft BUY without a near catalyst show days to CD (even beyond 20).",
      },
      {
        it: "Più la data è vicina, più opzioni, volume e G-Trends tendono a muoversi. T−2 è anche la finestra dei briefing documents FDA.",
        en: "The closer the date, the more options, volume, and Trends tend to move. T-2 is also the window for FDA briefing documents.",
      },
      {
        it: "Per investire: a 1–2 giorni serve una tesi già pronta (o stare fuori). A 8–10 giorni hai ancora tempo per leggere briefing, short interest e opzioni.",
        en: "For investing: at 1-2 days you need a thesis already in place (or stay out). At 8-10 days you still have time to read the briefing, short interest, and options.",
      },
    ],
  },
  trends: {
    title: { it: "G-Trends", en: "G-Trends" },
    paras: [
      {
        it: "Google Trends su ticker, nome società e prodotto (ricerche web USA). Riga principale = Δ% giorno-su-giorno (~3 mesi). Sotto, se c’è, lettura 24h. Non è un segnale di trading.",
        en: "Google Trends on the ticker, company name, and product (US web searches). Main line = day-vs-day % (~3 months). Below, when present, 24h read. Not a trading signal.",
      },
      {
        it: "Verde / freccia su = più ricerche. Rosso / freccia giù = meno ricerche. «=» stesso interesse. Weekend/festivi: si riporta l’ultimo valore registrato (ultima seduta Nasdaq), non una cella vuota.",
        en: "Green / up arrow = more searches. Red / down arrow = fewer searches. \"=\" same interest. Weekends/holidays: we show the last recorded print (last Nasdaq session), not an empty cell.",
      },
      {
        it: "Per investire: un’impennata di ricerche prima di un AdCom/PDUFA significa che arriva attenzione pubblica — spesso dopo che il «silent money» si è già mosso. Da sola non basta per comprare; se G-Trends esplode mentre prezzo/volume restano piatti, qualcuno potrebbe già vendere nel rumore.",
        en: "For investing: a spike in searches before an AdCom/PDUFA means public attention is arriving — often after \"silent money\" has already moved. Not enough on its own to buy; if G-Trends spikes while price/volume stay flat, someone may already be selling into the noise.",
      },
    ],
  },
  vol: {
    title: { it: "Volume", en: "Volume" },
    paras: [
      {
        it: "Confronta le azioni scambiate oggi (o nell’ultima seduta) con l’ultima seduta Nasdaq chiusa. Verde = più scambi, rosso = meno. È solo quantità, non direzione del prezzo.",
        en: "Compares shares traded today (or in the last session) to the last closed Nasdaq session. Green = more trading, red = less. This is quantity only, not price direction.",
      },
      {
        it: "Volume che raddoppia vicino a un catalyst significa che stanno entrando nuovi ordini. Volume quieto con evento a 3 giorni è ancora un mercato addormentato.",
        en: "Volume doubling near a catalyst means new orders are coming in. Quiet volume with an event 3 days out is still a sleepy market.",
      },
      {
        it: "Per investire: volume alto + prezzo in rialzo = partecipazione reale. Volume alto + prezzo in calo = distribuzione. Volume basso = ancora nessun consenso — entrare qui è più speculativo.",
        en: "For investing: high volume + rising price = real participation. High volume + falling price = distribution. Low volume = no consensus yet — entering here is more speculative.",
      },
    ],
  },
  diverge: {
    title: { it: "Conviction", en: "Conviction" },
    paras: [
      {
        it: "Combina direzione del prezzo e direzione del volume. «Together ↑/↓» = si muovono insieme. «Diverge» = il prezzo va da una parte, il volume dall’altra.",
        en: "Combines price direction and volume direction. \"Together ↑/↓\" = they move together. \"Diverge\" = price goes one way, volume the other.",
      },
      {
        it: "Prezzo su + volume giù può essere un rialzo debole (pochi compratori). Prezzo giù + volume su è pressione di vendita. Prezzo su + volume su è il caso più pulito.",
        en: "Price up + volume down can be a weak rally (few buyers). Price down + volume up is selling pressure. Price up + volume up is the cleanest case.",
      },
      {
        it: "Per investire: la divergenza è un campanello d’allarme, non un ordine. Se diverge proprio prima del catalyst, aspetta conferma (G-Trends, Expectation, Rec) prima di aumentare la size.",
        en: "For investing: divergence is a warning bell, not an order. If it diverges right before the catalyst, wait for confirmation (G-Trends, Expectation, Rec) before adding size.",
      },
    ],
  },
  ivr: {
    title: { it: "Expectation", en: "Expectation" },
    paras: [
      {
        it: "Due numeri. EM % = quanto grande il mercato prezza il salto vicino all’evento (ampiezza, non direzione). IVR = se quella Expectation è alta rispetto al solito (>1 = più tensione del normale).",
        en: "Two numbers. EM % = how large a jump the market prices near the event (size, not direction). IVR = whether that Expectation is elevated vs usual (>1 = more tension than normal).",
      },
      {
        it: "Freccia ↑ verde = Expectation in salita; ↓ rosso = in calo. Non dice se il titolo salirà o scenderà — per la direzione usa Skew. Grigio + lun/ven = stampa di una seduta chiusa, non live.",
        en: "Green ↑ = Expectation rising; red ↓ = falling. It does not say whether the stock will go up or down — use Skew for direction. Grey + Mon/Fri = last closed session print, not live.",
      },
    ],
  },
  skew: {
    title: { it: "Skew", en: "Skew" },
    paras: [
      {
        it: "Lo skew è il divario tra quanto costa scommettere su un rialzo (call) e quanto costa scommettere su un ribasso (put) — «costa» significa il premio (quanto paghi per comprare il contratto), non lo strike. Pensa a una put come a un’assicurazione contro il calo del titolo: il premio non è lo strike, è quanto la gente è disposta a pagare per quella protezione, spinto dalla domanda — come l’assicurazione contro le alluvioni che costa di più in una zona a rischio, non perché la casa valga di più. Una call funziona al contrario: il premio è quanto si paga per una scommessa a leva che il titolo salga.",
        en: "Skew is the gap between what it costs to bet on a rise (calls) and what it costs to bet on a fall (puts) — \"costs\" means the premium (what you pay to buy the contract), not the strike price. Think of a put as insurance against the stock falling: its premium isn't the strike, it's what people are willing to pay for that protection, driven by demand — like flood insurance costing more in a flood-prone area, not because the house is worth more. A call works the other way: its premium is what people pay for a leveraged bet that the stock rises.",
      },
      {
        it: "RR = IV call +10% − IV put −10%. PCR = volume put / volume call.",
        en: "RR = call IV +10% − put IV −10%. PCR = put volume / call volume.",
      },
      {
        it: "Se le call diventano relativamente più care delle put (RR positivo), più gente sta pagando la «scommessa sul rialzo» — upside spesso già nel prezzo → in desk lo coloriamo rosso (segnale negativo). Se diventano più care le put (RR negativo), più gente compra «assicurazione» contro un crollo → in desk verde (segnale positivo).",
        en: "If calls get relatively more expensive than puts (positive RR), more people are paying for the \"bet on the rise\" — upside often already in the price → desk paints it red (negative tell). If puts get more expensive (negative RR), more people are buying \"insurance\" against a crash → desk paints it green (positive tell).",
      },
      {
        it: "Per investire: uno skew call-ricco prima di un AdCom dice che il mercato sta già pagando l’upside (spesso già nel prezzo). Uno skew put-ricco dice che il downside è assicurato — un esito positivo può fare più male agli short, ma un flop è già temuto. Non è un ordine; è il termometro del posizionamento.",
        en: "For investing: a call-rich skew before an AdCom means the market is already paying for the upside (often already in the price). A put-rich skew means the downside is insured — a good outcome can hurt shorts more, but a flop is already feared. Not an order; it's the positioning thermometer.",
      },
    ],
  },
  short: {
    title: { it: "Short Trend", en: "Short Trend" },
    paras: [
      {
        it: "Lo short interest misura quante azioni sono oggi vendute allo scoperto — una scommessa che il prezzo scenda. Andare short significa: prendere in prestito azioni che non possiedi, venderle subito al prezzo di oggi, poi sperare di ricomprarle più basse, restituirle e intascare la differenza. A differenza di un acquisto normale (perdita max = quanto hai investito), uno short ha perdita teoricamente illimitata, perché il prezzo può salire senza tetto.",
        en: "Short interest tracks how many shares are currently sold short — a bet that the price will fall. Going short means: borrow shares you don't own, sell them now at today's price, then hope to buy them back later at a lower price, return the borrowed shares, and pocket the difference. Unlike a normal purchase (max loss = what you invested), a short position has theoretically unlimited loss, because the price can keep rising with no ceiling.",
      },
      {
        it: "ΔSI è la variazione dello short interest rispetto alla stampa precedente (dato bi-mensile FINRA/Yahoo) — la posizione short sta crescendo o calando? Non è un dato intra-day.",
        en: "ΔSI is the change in short interest vs. the previous print (bi-monthly FINRA/Yahoo data) — is the short position growing or shrinking? Not an intraday figure.",
      },
      {
        it: "In crescita = i ribassisti aumentano la scommessa, la loro convinzione si rafforza, non si indebolisce. In calo = alcuni stanno già chiudendo — ricomprano azioni per restituirle, ed è proprio quella pressione di buy-back dietro a uno short squeeze. Il DTC (days to cover) resta in sottotitolo, come contesto.",
        en: "Rising = bears are increasing the bet, their conviction is growing, not fading. Falling = some are already closing out — buying shares back to return them, which is exactly the buy-back pressure behind a short squeeze. DTC (days to cover) stays as a subtitle, for context.",
      },
      {
        it: "Per investire: uno short trend in calo vicino a un catalyst positivo può aiutare (meno pressione short, già un po’ di covering in corso). Uno in crescita dice che i ribassisti sono più convinti — non è un motivo automatico per comprare o vendere. Non è Soft BUY/SELL.",
        en: "For investing: a falling short trend near a positive catalyst can help (less short pressure, some covering already underway). A rising one means the bears are more convinced — not an automatic reason to buy or sell. Not a Soft BUY/SELL.",
      },
    ],
  },
  rec: {
    title: { it: "Rec", en: "Rec" },
    paras: [
      {
        it: "È la Soft BUY / Soft SELL già calcolata dal motore (stessi gate di Pulse e Top KPI). BUY, SELL, HOLD, REVIEW. Questa colonna non ricalcola nulla: mostra solo quello che il motore ha già deciso. Visibile solo all’account administrator.",
        en: "This is the Soft BUY / Soft SELL the engine already computed (same gates as Pulse and Top KPI). BUY, SELL, HOLD, REVIEW. This column recalculates nothing: it only shows what the engine already decided. Visible to the administrator account only.",
      },
      {
        it: "BUY = i gate di ingresso sono verdi (SDS, piano, streak, ecc.). SELL = un gate di uscita è scattato (G2, G1, continuation). HOLD/REVIEW = attenzione ma non c’è ancora un’azione automatica.",
        en: "BUY = entry gates are green (SDS, plan, streak, etc.). SELL = an exit gate fired (G2, G1, continuation). HOLD/REVIEW = watch, but no automatic action yet.",
      },
      {
        it: "Per investire: questa è l’unica colonna allineata ai gate operativi. Le altre (Trends, IV, SI…) sono indici a parte per capire il contesto. Non usare uno skew verde per forzare un BUY se qui c’è HOLD.",
        en: "For investing: this is the only column aligned with the operational gates. The others (Trends, IV, SI…) are separate context indices. Do not force a BUY off a green skew if this cell says HOLD.",
      },
    ],
  },
  bias: {
    title: { it: "Momentum", en: "Momentum" },
    paras: [
      {
        it: "Lettura direzionale, non un flag di attenzione. Combina il segno di RR, la divergenza prezzo/volume, InsiderNetBuy e il move vs XBI, con pesi di partenza (0.35 / 0.30 / 0.15 / 0.20) ancora da calibrare — un punto di partenza, non la verità.",
        en: "Directional read, not an attention flag. Combines the sign of RR, price/volume divergence, InsiderNetBuy, and move vs XBI, using starting weights (0.35 / 0.30 / 0.15 / 0.20) that still need calibration — a starting point, not the truth.",
      },
      {
        it: "Build rialzista se score > 0.3, Paura/hedge se < −0.3, altrimenti Misto. Recommendation resta il livello di attenzione; Momentum è solo la direzione.",
        en: "Bullish build if score > 0.3, Fear/hedge if < −0.3, otherwise Mixed. Recommendation is still the attention level; Momentum is direction only.",
      },
      {
        it: "Per investire: usalo per vedere se i tell puntano dalla stessa parte. Non forzare un BUY solo perché Momentum è verde quando Recommendation dice HOLD.",
        en: "For investing: use it to see whether the tells point the same way. Don't force a BUY just because Momentum is green when Recommendation says HOLD.",
      },
    ],
  },
  accum: {
    title: { it: "Insider Buying", en: "Insider Buying" },
    paras: [
      {
        it: "Denaro/posizionamento che si muove prima che la notizia sia pubblica: chi è vicino all’azienda (insider, fondi specializzati) costruisce — o smonta — posizioni in silenzio, prima che il resto del mercato se ne accorga.",
        en: "Money/positioning that moves before the news is public: people close to the company (insiders, specialized funds) quietly build — or unwind — positions before the rest of the market notices.",
      },
      {
        it: "Senso stretto e originario = accumulo silenzioso positivo: Form 4 (un dirigente compra azioni della propria società, dichiarato alla SEC) e 13D/13G (un fondo costruisce o aumenta una partecipazione rilevante). Le vendite su piano 10b5-1 predefinito sono escluse (rutinari, non informative). Fonte preferita: sec-api.io; fallback FMP.",
        en: "Strict, original sense = quiet positive accumulation: Form 4 (an executive buys their own company's stock, disclosed to the SEC) and 13D/13G (a fund builds or increases a significant stake). Sales under a pre-set 10b5-1 plan are excluded (routine, not informative). Preferred source: sec-api.io; fallback FMP.",
      },
      {
        it: "Per investire: se qualcuno vicino all’azienda compra con i propri soldi nelle settimane prima di un catalyst, vale la pena notarlo — sa più di te. Non è certezza e non è Soft BUY/SELL: incrocialo con Recommendation e il tipo di evento. Le uscite dei dirigenti stanno in una colonna a parte (Exec Exit).",
        en: "For investing: if someone close to the company buys with their own money in the weeks before a catalyst, it's worth noting — they know more than you do. Not a certainty, and not a Soft BUY/SELL: cross-check it against Recommendation and the event type. Executive departures live in a separate column (Exec Exit).",
      },
    ],
  },
  silent: {
    title: { it: "Insider Buying", en: "Insider Buying" },
    paras: [
      {
        it: "Denaro/posizionamento che si muove prima che la notizia sia pubblica: chi è vicino all’azienda (insider, fondi specializzati) costruisce — o smonta — posizioni in silenzio, prima che il resto del mercato se ne accorga.",
        en: "Money/positioning that moves before the news is public: people close to the company (insiders, specialized funds) quietly build — or unwind — positions before the rest of the market notices.",
      },
      {
        it: "Senso stretto = Form 4 + 13D/13G. Vendite 10b5-1 escluse. Fonte preferita sec-api.io.",
        en: "Strict sense = Form 4 + 13D/13G. 10b5-1 sales excluded. Preferred source sec-api.io.",
      },
      {
        it: "Per investire: segnale precoce, non Soft BUY/SELL. Exec Exit è la colonna delle uscite.",
        en: "For investing: early tell, not Soft BUY/SELL. Exec Exit is the departures column.",
      },
    ],
  },
  gov: {
    title: { it: "Exec Exit", en: "Exec Exit" },
    paras: [
      {
        it: "Scansiona gli 8-K Item 5.02 (sec-api.io) per uscite e nomine di officer/board negli ultimi ~60 giorni. Se un dirigente lascia (CFO/CEO/CMO…), la cella lo riporta per nome.",
        en: "Scans 8-K Item 5.02 filings (sec-api.io) for officer/board departures and appointments in the last ~60 days. If an executive leaves (CFO/CEO/CMO...), the cell names them.",
      },
      {
        it: "Prima le uscite («X ha lasciato»). Le nomine board restano visibili, con tono più leggero. «—» se non c’è Item 5.02 recente.",
        en: "Departures come first (\"X departed\"). Board appointments still show, but with a lighter tone. \"—\" if there's no recent Item 5.02.",
      },
      {
        it: "Per investire: un’uscita di CMO/CEO vicino a un evento binario è un motivo per ridurre la size o stare fuori, anche se Insider Buying è verde. Non è Soft BUY/SELL.",
        en: "For investing: a CMO/CEO departure close to a binary event is a reason to cut size or stay out, even if Insider Buying is green. Not a Soft BUY/SELL.",
      },
    ],
  },
  vsxbi: {
    title: { it: "vs XBI", en: "vs XBI" },
    paras: [
      {
        it: "Move relativo al settore: rendimento del titolo meno rendimento di XBI (semplificato, β=1). Separa l’excitement specifico sul titolo da un rally biotech di tutto il settore.",
        en: "Move relative to the sector: stock return minus XBI return (simplified, β=1). Separates stock-specific excitement from a sector-wide biotech rally.",
      },
      {
        it: "Verde = il titolo batte XBI sulla finestra (5g). Rosso = sottoperforma. «—» se non c’è abbastanza storia di prezzo. Il beta rolling a 60 giorni arriverà dopo.",
        en: "Green = the stock beats XBI over the window (5d). Red = underperforms. \"—\" if there's not enough price history. Rolling 60-day beta will come later.",
      },
      {
        it: "Per investire: una forte outperformance vs settore prima dell’evento suggerisce interesse specifico sul nome. Un rally che c’è solo perché sale il settore non è una tesi da sola. Non è Soft BUY/SELL.",
        en: "For investing: a strong outperformance vs sector before the event suggests name-specific interest. A rally that's only there because the sector is up isn't a thesis on its own. Not a Soft BUY/SELL.",
      },
    ],
  },
  d1h: {
    title: { it: "Δ visit", en: "Δ visit" },
    paras: [
      {
        it: "Variazione % del prezzo rispetto all’ultima visita oraria del Catalyst desk (last_close del pack corrente vs pack precedente, tipicamente ~1 ora).",
        en: "Percent price change vs the Catalyst desk’s previous hourly visit (current pack last_close vs prior pack, typically ~1 hour).",
      },
      {
        it: "Verde = sale dall’ultima call, rosso = scende, ambra = quasi flat. «—» finché non ci sono almeno due pack orari consecutivi. Non è Soft BUY/SELL.",
        en: "Green = up since last call, red = down, amber = near flat. \"—\" until two consecutive hourly packs exist. Not Soft BUY/SELL.",
      },
      {
        it: "Per investire: cattura il micro-move tra un refresh e l’altro, complementary a Δ24h (sessione intera).",
        en: "For investing: captures the micro-move between refreshes, complementary to Δ24h (full session).",
      },
    ],
  },
  d24: {
    title: { it: "Δ24h", en: "Δ24h" },
    paras: [
      {
        it: "Variazione percentuale del prezzo sulla sessione ~24h (Var. Giorn. dalla Simulation / ultima sessione). È il move grezzo del titolo, non vs settore.",
        en: "Percent price change over the ~24h session (Simulation daily % / last session). Raw stock move, not vs sector.",
      },
      {
        it: "Verde = salita, rosso = discesa, ambra = quasi flat. «—» se manca il prezzo. Non è Soft BUY/SELL.",
        en: "Green = up, red = down, amber = near flat. \"—\" if price is missing. Not Soft BUY/SELL.",
      },
      {
        it: "Per investire: usalo insieme a Last Order e vs XBI per capire se il titolo si sta già muovendo prima dell’evento, o se il move è solo settoriale.",
        en: "For investing: use it with Last Order and vs XBI to see whether the name is already moving into the event, or whether the move is only sector-driven.",
      },
    ],
  },
  preopen: {
    title: { it: "Pre-Open", en: "Pre-Open" },
    paras: [
      {
        it: "Nei minuti prima dell'apertura (9:28-9:30 ET su Nasdaq, 9:00-9:30 su NYSE), le borse pubblicano quanti ordini di acquisto e vendita sono in coda per l'asta di apertura, con un prezzo indicativo di match. Non è tutto il pre-market, solo gli ordini destinati a quell'asta specifica.",
        en: "In the minutes before the open (9:28-9:30 ET on Nasdaq, 9:00-9:30 ET on NYSE), exchanges publish how many buy and sell orders are queued for the opening auction, along with an indicative match price. This isn't the whole pre-market — only the orders earmarked for that specific auction.",
      },
      {
        it: "Freccia verde/Buy = più ordini di acquisto in coda, prezzo indicativo sopra la chiusura precedente. Freccia rossa/Sell = il contrario. \"—\" fuori dalla finestra pre-apertura o nei giorni senza dato.",
        en: "Green arrow / Buy = more buy orders queued, indicative price above the prior close. Red arrow / Sell = the opposite. \"—\" outside the pre-open window or on days with no data.",
      },
      {
        it: "Per investire: uno sbilanciamento forte e in crescita nei minuti prima dell'apertura, su un titolo con evento quel giorno, è un segnale diretto di pressione netta prima ancora che il mercato apra — utile per capire con che piede il titolo aprirà, ma non sostituisce Recommendation/Signal.",
        en: "For investing: a strong and growing imbalance in the minutes before the open, on a stock with an event that day, is a direct read on net pressure before the market even opens — useful to gauge how the stock will open, but it doesn't replace Recommendation/Signal.",
      },
    ],
  },
  premkt: {
    title: { it: "Last Order", en: "Last Order" },
    paras: [
      {
        it: "Proxy gratuito dell'order imbalance ufficiale: usa prezzo e volume dei trade già eseguiti in pre-market (4:00-9:30 ET), non gli ordini in coda per l'asta — è un'approssimazione, non il dato proprietario delle borse.",
        en: "Free proxy of the official order imbalance: uses price and volume from trades already executed in pre-market (4:00-9:30 ET), not the orders queued for the auction — an approximation, not the exchanges' proprietary print.",
      },
      {
        it: "\"Together ↑/↓\" = prezzo e volume pre-market si muovono insieme e il volume è chiaramente sopra la norma — segnale di partecipazione reale (serve volume live da quote Yahoo; il chart 5m spesso ha Volume=0 in extended hours). \"Diverge\" = il prezzo si muove ma il volume non conferma (o manca) — mossa debole. \"—\" = nessun print pre-market. Nei festivi/weekend si mostra l'ultima sessione disponibile.",
        en: "\"Together ↑/↓\" = pre-market price and volume move together and volume is clearly above normal — real participation (needs live Yahoo quote volume; the 5m chart often has Volume=0 in extended hours). \"Diverge\" = price moves but volume does not confirm (or is missing) — a weak move. \"—\" = no pre-market print. On holidays/weekends we show the last available session.",
      },
      {
        it: "Per investire: è un'approssimazione, non l'imbalance vero — usalo come primo filtro gratuito prima di decidere se vale la pena pagare per il dato ufficiale su un ticker specifico. Se conferma allineamento con Search Buzz, il segnale è più robusto; da solo resta indicativo, non un gate operativo.",
        en: "For investing: it's an approximation, not the real imbalance — use it as a free first filter before deciding whether the official feed is worth paying for on a specific name. If it confirms alignment with Search Buzz, the read is more robust; alone it stays indicative, not an operational gate.",
      },
    ],
  },
  uoa: {
    title: { it: "UOA", en: "UOA" },
    paras: [
      {
        it: "Unusual Options Activity: volume odierno su uno strike > 5× la media 20g e anche > open interest di ieri (posizioni nuove, non chiusure).",
        en: "Unusual Options Activity: today’s strike volume > 5× 20d average and also > yesterday’s open interest (new positions, not closings).",
      },
      {
        it: "La media 20g la costruiamo noi: ogni giorno salviamo volume/OI Yahoo per strike. Finché non ci sono 20 sedute vedi — (tooltip X/20). Poi il badge `Call 5.2x vol` / `Put 6x vol`. Sweep multi-exchange → v3.",
        en: "We build the 20d average ourselves: each day we store Yahoo volume/OI per strike. Until 20 sessions you see — (tooltip X/20). Then the `Call 5.2x vol` / `Put 6x vol` badge. Multi-exchange sweeps → v3.",
      },
      {
        it: "Per investire: UOA call pre-evento è un tell di scommessa direzionale; UOA put di hedge/paura. Utile come conferma, pericoloso da solo su micro-cap illiquide. Non è Soft BUY/SELL.",
        en: "For investing: pre-event call UOA is a directional bet tell; put UOA is hedge/fear. Useful as confirmation, dangerous alone on illiquid micro-caps. Not Soft BUY/SELL.",
      },
    ],
  },
  fda: {
    title: { it: "FDA Briefing", en: "FDA Briefing" },
    paras: [
      {
        it: "Score o «File» quando i materiali AdCom sono pubblicati. Il link briefing e i summary vivono nella finestra Event (non più il countdown T−2 in questa colonna).",
        en: "Score or \"File\" when AdCom materials are published. Briefing link and summaries live in the Event window (T−2 countdown is no longer in this column).",
      },
      {
        it: "Compare solo se c’è un meeting FDA in tabella e i materiali sono stati trovati. «—» = ancora nessun file (troppo presto, o l’evento non è un AdCom) — apri Event per lo stato meeting.",
        en: "Only appears if there's an FDA meeting in the table and materials have been found. \"—\" = no file yet (too early, or the event isn't an AdCom) — open Event for meeting status.",
      },
      {
        it: "Per investire: il briefing è spesso il primo testo «ufficiale» che muove il titolo prima del voto. Uno score debole a T−2 è un motivo per ridurre, non per raddoppiare. Non sostituisce Soft BUY/SELL e non predice il voto del comitato.",
        en: "For investing: the briefing is often the first \"official\" text that moves the stock ahead of the vote. A weak score at T-2 is a reason to cut, not double down. It doesn't replace Soft BUY/SELL and doesn't predict the committee's vote.",
      },
    ],
  },
};

/** One-screen hover card: what the column is, in plain language. */
const PLAIN: Record<CatalystLegendTopic, { it: string; en: string }> = {
  ticker: {
    it: "Simbolo Nasdaq del titolo. Clicca il ticker per aprire la scheda della società.",
    en: "Nasdaq symbol. Click the ticker to open that company’s card.",
  },
  productDesig: {
    it: "Nome del prodotto in riga (farmaco o device) e, sotto, le designation FDA (Orphan, Fast Track, Breakthrough…). Non è un segnale di comprare.",
    en: "Product name on the row (drug or device) and, below, FDA designations (Orphan, Fast Track, Breakthrough…). Not a buy signal.",
  },
  newsScores: {
    it: "Daily Score: Σ Clin / Fin / Soc / Acc delle ultime 36 ore (Daily News + Deep Dive). Non è un unico «EIS» di mercato — ogni dimensione è indipendente.",
    en: "Daily Score: Σ Clin / Fin / Corp / Acc over the last 36 hours (Daily News + Deep Dive). Not one market “EIS” — each dimension is independent.",
  },
  event: {
    it: "I CD (Catalyst Days) marcano eventi e milestone aziendali attesi a innescare una reazione di mercato.",
    en: "CD (Catalyst Days) mark events and company milestones expected to trigger a market reaction.",
  },
  day: {
    it: "Giorni che mancano all’evento. 0d = oggi, 5d = tra cinque giorni. Più è vicino, più prezzo e volume possono muoversi.",
    en: "Days until the event. 0d = today, 5d = in five days. The closer it is, the more price and volume can move.",
  },
  trends: {
    it: "Google Trends: quante persone cercano ticker / società / prodotto. Verde = più ricerche, rosso = meno, «=» invariato. Non è un ordine di trading.",
    en: "Google Trends: how many people search the ticker / company / product. Green = more searches, red = fewer, “=” unchanged. Not a trade order.",
  },
  vol: {
    it: "Volume di oggi rispetto all’ultima seduta. Verde = più scambi, rosso = meno. Dice quanto si negozia, non se il prezzo sale o scende.",
    en: "Today’s volume vs the last session. Green = more trading, red = less. Quantity of trades — not whether the price is up or down.",
  },
  diverge: {
    it: "Conviction: se prezzo e volume si muovono insieme (Together ↑/↓) o no (Diverge). Insieme + rialzo = partecipazione reale; divergono = mossa più debole.",
    en: "Conviction: whether price and volume move together (Together ↑/↓) or not (Diverge). Together + up = real participation; diverge = a weaker move.",
  },
  ivr: {
    it: "Expectation: EM % = ampiezza del salto prezzata dal mercato (non su/giù). ↑ verde = tensione in salita, ↓ rosso = in calo. IVR sotto = quanto è alta vs il solito.",
    en: "Expectation: EM % = size of the jump the market prices (not up/down). Green ↑ = rising tension, red ↓ = falling. IVR below = how elevated vs usual.",
  },
  skew: {
    it: "Skew: se costa di più scommettere sul rialzo (call) o proteggersi dal ribasso (put). Call care = upside già nel prezzo; put care = paura di un crollo.",
    en: "Skew: whether it costs more to bet on a rise (calls) or hedge a fall (puts). Expensive calls = upside often priced in; expensive puts = crash fear.",
  },
  short: {
    it: "Short Trend: se lo short interest sta crescendo o calando. In calo = alcuni ribassisti ricomprano (possibile squeeze). Non è Soft BUY/SELL.",
    en: "Short Trend: whether short interest is rising or falling. Falling = some shorts are covering (possible squeeze). Not Soft BUY/SELL.",
  },
  rec: {
    it: "Raccomandazione del motore (solo admin): BUY / SELL / HOLD / REVIEW. È l’unica colonna allineata ai gate operativi.",
    en: "Engine recommendation (admin only): BUY / SELL / HOLD / REVIEW. The only column aligned with the operational gates.",
  },
  bias: {
    it: "Momentum: direzione dei tell (opzioni, volume, insider, vs settore). «Bullish build» = spinta al rialzo. Non è un ordine di BUY — è solo la direzione.",
    en: "Momentum: direction of the tells (options, volume, insider, vs sector). “Bullish build” = upward pressure. Not a BUY order — direction only.",
  },
  accum: {
    it: "Insider Buying: dirigenti o fondi che comprano azioni prima che la notizia sia pubblica (Form 4 / 13D). Segnale precoce, non un ordine.",
    en: "Insider Buying: executives or funds buying before the news is public (Form 4 / 13D). An early tell, not an order.",
  },
  silent: {
    it: "Insider Buying: acquisti silenziosi (Form 4 / 13D) prima della notizia. Non è Soft BUY/SELL.",
    en: "Insider Buying: quiet buys (Form 4 / 13D) before the news. Not Soft BUY/SELL.",
  },
  gov: {
    it: "Exec Exit: un dirigente (CEO/CFO/CMO) ha lasciato di recente. Vicino a un evento binario è un motivo per stare più prudenti.",
    en: "Exec Exit: an officer (CEO/CFO/CMO) left recently. Near a binary event, a reason to be more cautious.",
  },
  vsxbi: {
    it: "vs XBI: rendimento del titolo meno il settore biotech (ETF XBI). Verde = batte il settore; rosso = resta indietro.",
    en: "vs XBI: stock return minus the biotech sector (XBI ETF). Green = beats the sector; red = lags.",
  },
  d1h: {
    it: "Δ visit: variazione % del prezzo rispetto all’ultima call oraria del desk (~1 ora). Verde = sale, rosso = scende.",
    en: "Δ visit: percent price change vs the desk’s previous hourly call (~1 hour). Green = up, red = down.",
  },
  d24: {
    it: "Δ24h: variazione % del prezzo nell’ultima sessione (~24 ore). Verde = sale, rosso = scende.",
    en: "Δ24h: percent price change in the last ~24h session. Green = up, red = down.",
  },
  preopen: {
    it: "Pre-Open: sbilanciamento ordini nell’asta di apertura. Buy = più acquisti in coda; Sell = più vendite.",
    en: "Pre-Open: order imbalance in the opening auction. Buy = more buys queued; Sell = more sells.",
  },
  premkt: {
    it: "Last Order: come si sta muovendo il pre-market (prezzo + volume). Together ↑ = partecipazione reale prima dell’apertura.",
    en: "Last Order: how pre-market is moving (price + volume). Together ↑ = real participation before the open.",
  },
  uoa: {
    it: "UOA: attività opzioni insolita (volume molto sopra la media). Call = scommessa al rialzo; Put = hedge/paura.",
    en: "UOA: unusual options activity (volume far above average). Call = upside bet; Put = hedge/fear.",
  },
  fda: {
    it: "FDA Briefing: score/file quando pubblicato. Link e summary nella finestra Event (niente countdown T−2 qui).",
    en: "FDA Briefing: score/file when published. Link and summary in the Event window (no T−2 countdown here).",
  },
};

export function catalystColumnHint(
  topic: CatalystLegendTopic,
  it: boolean,
): { title: string; body: string } {
  const copy = LEGENDS[topic];
  const plain = PLAIN[topic];
  return {
    title: it ? copy.title.it : copy.title.en,
    body: it ? plain.it : plain.en,
  };
}

export function EventVolLegendModal({
  topic,
  it,
  onClose,
}: {
  topic: CatalystLegendTopic | null;
  it: boolean;
  onClose: () => void;
}) {
  const copy = topic ? LEGENDS[topic] : null;
  const title = copy ? (it ? copy.title.it : copy.title.en) : "";
  return (
    <AppModal
      open={topic != null && copy != null}
      onClose={onClose}
      aria-label={it ? `Legenda ${title}` : `${title} legend`}
      panelClassName="w-[min(94vw,34rem)]"
    >
      <div className="card w-full max-h-[85vh] overflow-hidden shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
              {it ? "Legenda" : "Legend"}
            </p>
            <h3 className="text-sm font-bold text-ink mt-0.5">{title}</h3>
          </div>
          <AppModalCloseButton onClose={onClose} />
        </header>
        <div className="px-4 py-3 overflow-y-auto text-[12px] text-ink leading-snug space-y-2.5">
          {copy?.paras.map((p) => (
            <p key={p.en}>{it ? p.it : p.en}</p>
          ))}
          <p className="text-ink-muted">
            {topic === "rec"
              ? it
                ? "Questa colonna è la Soft BUY/SELL già calcolata. Le altre colonne non cambiano i gate."
                : "This column is the Soft BUY/SELL already computed. The other columns do not change the gates."
              : it
                ? "Indice a parte: non entra in Soft BUY/SELL."
                : "Separate index: not a Soft BUY/SELL gate."}
          </p>
        </div>
      </div>
    </AppModal>
  );
}
