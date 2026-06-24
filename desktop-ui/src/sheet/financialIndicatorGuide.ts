/** Guida indicatori tab Financial — testi IT/EN per pannello a scomparsa. */

export type FinGuideEntry = {
  id: string;
  title: string;
  body: string;
};

export type FinGuideSection = {
  id: string;
  title: string;
  entries: FinGuideEntry[];
};

export function financialIndicatorSections(it: boolean): FinGuideSection[] {
  if (it) {
    return [
      {
        id: "id",
        title: "Identità titolo",
        entries: [
          { id: "symbol", title: "Ticker (symbol)", body: "Simbolo borsa. Badge P = in Portfolio (capitale > 0 in Simulation), W = in watchlist." },
          { id: "companyName", title: "Company", body: "Nome società da Yahoo Finance." },
          { id: "sector", title: "Sector / Industry", body: "Settore e industria GICS-style." },
        ],
      },
      {
        id: "val",
        title: "Valutazione",
        entries: [
          { id: "marketCap", title: "Mkt cap", body: "Capitalizzazione di mercato ($). Barra verde: larghezza vs min–max colonna in tabella." },
          { id: "enterpriseValue", title: "Enterprise value", body: "EV = cap + debito − cassa ($). Barra navy (scala log): larghezza vs min–max EV in tabella." },
        ],
      },
      {
        id: "price",
        title: "Prezzi e variazioni",
        entries: [
          { id: "currentPrice", title: "Price", body: "Prezzo corrente ($). Barra navy proporzionale al prezzo nella tabella." },
          { id: "last_close", title: "Last close", body: "Ultima chiusura ($). ★ se prezzo attuale ≥+5% vs chiusura; ⚡ se ≤−5%. Testo verde/rosso allo stesso scarto." },
          { id: "highPrice", title: "High / Low / Avg 1M·3M·6M", body: "Massimo/minimo 52 settimane e medie chiusura. ★ se il livello è ≥+5% vs prezzo attuale; ⚡ se ≤−5%." },
          { id: "dailyChange_%", title: "Day % · 1M % · 3M % · 6M %", body: "Variazioni % con ▲ verde / ▼ rosso (senza riempimento cella). Day = vs chiusura precedente; 1M/3M/6M = vs media chiusura periodo." },
        ],
      },
      {
        id: "liq",
        title: "Liquidità FY (bilancio annuale)",
        entries: [
          { id: "current_ratio", title: "Current ratio", body: "Attivo corrente ÷ passivo corrente. <1 rosso · 1–1,5 ambra · ≥1,5 verde · barra = intensità (cap visual 20)." },
          { id: "quick_ratio", title: "Quick ratio", body: "(Attivo corrente − magazzino) ÷ passivo corrente. <0,8 rosso · 0,8–1 ambra · ≥1 verde." },
          { id: "cash_ratio", title: "Cash ratio", body: "(Cassa + titoli brevi) ÷ passivo corrente. <0,25 rosso · 0,25–0,5 ambra · ≥0,5 verde." },
          { id: "liquidita_fy", title: "Liquidity FY", body: "Riepilogo testuale CR/QR/Cash (chip colorati)." },
          { id: "liquidity_score", title: "Liq score", body: "Score 0–1 (più alto = più liquido). Barra e colore: verde alto, ambra medio, navy basso. 1,00 = neutro se mancano i ratio." },
          { id: "liquidity_fy_date", title: "Liquidity FY date", body: "Data chiusura esercizio del bilancio usato per i ratio." },
        ],
      },
      {
        id: "risk",
        title: "Rischio",
        entries: [
          { id: "beta", title: "Beta", body: "Beta 5Y vs mercato. >2 ⚡ · 1,35–2 verde · <0,85 navy. Non è consulenza finanziaria." },
        ],
      },
    ];
  }
  return [
    {
      id: "id",
      title: "Ticker identity",
      entries: [
        { id: "symbol", title: "Ticker (symbol)", body: "Listing symbol. P = Portfolio (capital > 0 in Simulation), W = watchlist." },
        { id: "companyName", title: "Company", body: "Company name from Yahoo Finance." },
        { id: "sector", title: "Sector / Industry", body: "Sector and industry classification." },
      ],
    },
    {
      id: "val",
      title: "Valuation",
      entries: [
        { id: "marketCap", title: "Mkt cap", body: "Market cap ($). Green bar width vs column min–max." },
        { id: "enterpriseValue", title: "Enterprise value", body: "EV = cap + debt − cash ($). Navy bar (log scale) vs column min–max." },
      ],
    },
    {
      id: "price",
      title: "Prices & returns",
      entries: [
        { id: "currentPrice", title: "Price", body: "Last trade ($). Navy bar scaled to visible column range." },
        { id: "last_close", title: "Last close", body: "Prior session close ($). ★ if current price ≥+5% vs close; ⚡ if ≤−5%." },
        { id: "highPrice", title: "High / Low / Avg 1M·3M·6M", body: "52-week high/low and average closes. ★/⚡ vs current price at ±5%." },
        { id: "dailyChange_%", title: "Day % · 1M % · 3M % · 6M %", body: "Green ▲ / red ▼ text only. Day = vs prior close; 1M/3M/6M = vs period avg close." },
      ],
    },
    {
      id: "liq",
      title: "FY liquidity (annual balance sheet)",
      entries: [
        { id: "current_ratio", title: "Current ratio", body: "Current assets ÷ current liabilities. <1 red · 1–1.5 amber · ≥1.5 green · bar = strength (visual cap 20)." },
        { id: "quick_ratio", title: "Quick ratio", body: "(Current assets − inventory) ÷ current liabilities. <0.8 red · 0.8–1 amber · ≥1 green." },
        { id: "cash_ratio", title: "Cash ratio", body: "(Cash + short-term investments) ÷ current liabilities. <0.25 red · 0.25–0.5 amber · ≥0.5 green." },
        { id: "liquidita_fy", title: "Liquidity FY", body: "Text summary of CR/QR/Cash with colored chips." },
        { id: "liquidity_score", title: "Liq score", body: "Composite 0–1 (higher = stronger). Bar + color tiers; 1.00 = neutral when ratios missing." },
        { id: "liquidity_fy_date", title: "Liquidity FY date", body: "Fiscal year-end date used for ratios." },
      ],
    },
    {
      id: "risk",
      title: "Risk",
      entries: [
        { id: "beta", title: "Beta", body: "5Y beta vs market. >2 ⚡ · 1.35–2 green · <0.85 navy. Not financial advice." },
      ],
    },
  ];
}

export const FIN_LEGEND_COMPACT_IT =
  "Apri «Guida indicatori» per definizioni complete. Colori: var.% ▲▼ · barre $/ratio · ★/⚡ ±5% · P/W.";

export const FIN_LEGEND_COMPACT_EN =
  "Open «Indicator guide» for full definitions. Colors: var.% ▲▼ · $/ratio bars · ★/⚡ ±5% · P/W.";
