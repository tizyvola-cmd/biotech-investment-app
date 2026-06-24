export type TradeAction = "BUY" | "SELL" | "HOLD" | "REVIEW";

export type Trade = {
  id: string;
  date: string;
  ticker: string;
  action: TradeAction;
  /** Prezzo per azione USD al momento dell'operazione. */
  price: number | null;
  qty: number | null;
  /** Valore nominale in € (capitale paper). */
  value: number;
  pnl: number | null;
  pnlPct: number | null;
  /** SELL only — Var. 24h post-vendita (proxy esito consiglio). */
  postMovePct24h?: number | null;
  /** SELL only — giusto ✓ se il titolo scende dopo la vendita, sbagliato ✗ se sale. */
  adviceOutcome?: "good" | "bad" | "pending" | null;
};

export type PortfolioPoint = {
  date: string;
  value: number;
  /** P&L totale € in quel punto (opzionale, per tooltip). */
  totalPnlEur?: number;
};
