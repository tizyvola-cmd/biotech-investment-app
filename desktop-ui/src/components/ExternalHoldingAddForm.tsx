import { useState } from "react";
import { parseInputDecimal } from "../sheet/decimalInput";
import type { ExternalHoldingFail } from "../sheet/externalHolding";
import type { RegisterExternalHoldingHandler } from "../hooks/useInvestSimInputs";
import { useLang, useT } from "../shared/i18n";

const FAIL_KEY: Record<ExternalHoldingFail, "dashboard.pulse.external.fail.emptyTicker"
  | "dashboard.pulse.external.fail.badCapital"
  | "dashboard.pulse.external.fail.notInUniverse"
  | "dashboard.pulse.external.fail.alreadyOpen"
  | "dashboard.pulse.external.fail.noPrice"
  | "dashboard.pulse.external.fail.badDate"
  | "dashboard.pulse.external.fail.persist"> = {
  empty_ticker: "dashboard.pulse.external.fail.emptyTicker",
  bad_capital: "dashboard.pulse.external.fail.badCapital",
  not_in_universe: "dashboard.pulse.external.fail.notInUniverse",
  already_open: "dashboard.pulse.external.fail.alreadyOpen",
  no_price: "dashboard.pulse.external.fail.noPrice",
  bad_date: "dashboard.pulse.external.fail.badDate",
  persist: "dashboard.pulse.external.fail.persist",
};

export function ExternalHoldingAddForm({
  onAdd,
  embedded = false,
}: {
  onAdd: RegisterExternalHoldingHandler;
  /** Flush pane inside a shared window (no extra card chrome). */
  embedded?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [ticker, setTicker] = useState("");
  const [capital, setCapital] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const submit = () => {
    setBusy(true);
    setMessage(null);
    try {
      const typedBuy = buyPrice.trim();
      const parsedBuy = typedBuy ? parseInputDecimal(typedBuy) : null;
      const result = onAdd({
        ticker,
        capitalEur: parseInputDecimal(capital),
        buyPriceUsd: parsedBuy != null && parsedBuy > 0 ? parsedBuy : null,
        purchaseDate: purchaseDate.trim() || null,
      });
      if (!result.ok) {
        const text = t(FAIL_KEY[result.reason]);
        setMessage({ kind: "err", text });
        return;
      }
      setMessage({
        kind: "ok",
        text: t("dashboard.pulse.external.added", { ticker: result.ticker }),
      });
      setTicker("");
      setCapital("");
      setBuyPrice("");
      setPurchaseDate("");
    } catch {
      setMessage({
        kind: "err",
        text: t("dashboard.pulse.external.fail.persist"),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={
        embedded
          ? "h-full min-w-0"
          : "mt-2 rounded-xl border border-[rgb(var(--panel-feed-border))]/45 bg-[rgb(var(--panel-feed-header-bg))]/40 px-3 py-2"
      }
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {t("dashboard.pulse.external.title")}
      </p>
      <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">
        {t("dashboard.pulse.external.hint")}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-1.5">
        <label className="flex flex-col gap-0.5 min-w-[5.5rem]">
          <span className="text-[9px] uppercase tracking-wide text-ink-muted">
            {it ? "Ticker" : "Ticker"}
          </span>
          <input
            className="input w-24 py-0.5 text-xs uppercase"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="CPIX"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-0.5 min-w-[6rem]">
          <span className="text-[9px] uppercase tracking-wide text-ink-muted">
            {it ? "Investito €" : "Invested €"}
          </span>
          <input
            className="input w-24 py-0.5 text-xs tabular-nums"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            placeholder="6000"
            inputMode="decimal"
          />
        </label>
        <label className="flex flex-col gap-0.5 min-w-[5.5rem]">
          <span className="text-[9px] uppercase tracking-wide text-ink-muted">
            {it ? "Prezzo $ (opz.)" : "Buy $ (opt.)"}
          </span>
          <input
            className="input w-24 py-0.5 text-xs tabular-nums"
            value={buyPrice}
            onChange={(e) => setBuyPrice(e.target.value)}
            placeholder={it ? "spot" : "spot"}
            inputMode="decimal"
          />
        </label>
        <label className="flex flex-col gap-0.5 min-w-[7.5rem]">
          <span className="text-[9px] uppercase tracking-wide text-ink-muted">
            {it ? "Data (opz.)" : "Date (opt.)"}
          </span>
          <input
            type="date"
            className="input w-[8.5rem] py-0.5 text-xs tabular-nums"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="btn-ghost text-[10px] font-semibold uppercase tracking-wide px-2 py-1 border border-[rgb(var(--signal-up))]/40 bg-[rgb(var(--signal-up))]/12 text-[rgb(var(--signal-up))] hover:bg-[rgb(var(--signal-up))]/18 disabled:opacity-50"
          onClick={(e) => e.stopPropagation()}
        >
          {busy ? t("dashboard.pulse.external.adding") : t("dashboard.pulse.external.add")}
        </button>
      </div>
      {message ? (
        <p
          role="status"
          className={`mt-1.5 text-[11px] font-semibold leading-snug ${
            message.kind === "ok"
              ? "text-[rgb(var(--signal-up))]"
              : "text-[rgb(var(--signal-down))]"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
