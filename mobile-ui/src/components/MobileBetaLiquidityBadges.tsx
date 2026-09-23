import {
  betaBucketLabel,
  betaDisplay,
  liquidityBarStyle,
  parseLiquidityRatiosFromDisplay,
  resolveSimRowBeta,
  resolveSimRowLiquiditaFy,
  resolveSimRowLiquidityScore,
} from "../mobileSimRowBeta";
import { useMobileLang } from "../hooks/useMobileLang";

const LIQ_CHIP_TONE = {
  ok: "mob-beta-liq-chip--ok",
  warn: "mob-beta-liq-chip--warn",
  risk: "mob-beta-liq-chip--risk",
} as const;

function parseLiqChips(fy: string): { label: string; value: string; tone: keyof typeof LIQ_CHIP_TONE }[] {
  const out: { label: string; value: string; tone: keyof typeof LIQ_CHIP_TONE }[] = [];
  const cr = /CR\s*([\d.]+)/i.exec(fy);
  const qr = /QR\s*([\d.]+)/i.exec(fy);
  const cash = /Cash[^|]*?([\d.]+)\s*M/i.exec(fy) ?? /Cash\s*([\d.]+)/i.exec(fy);
  if (cr) {
    const n = Number(cr[1]);
    out.push({
      label: "CR",
      value: Number.isFinite(n) ? n.toFixed(2) : cr[1]!,
      tone: !Number.isFinite(n) || n >= 1.5 ? "ok" : n >= 1 ? "warn" : "risk",
    });
  }
  if (qr) {
    const n = Number(qr[1]);
    out.push({
      label: "QR",
      value: Number.isFinite(n) ? n.toFixed(2) : qr[1]!,
      tone: !Number.isFinite(n) || n >= 1 ? "ok" : n >= 0.8 ? "warn" : "risk",
    });
  }
  if (cash) {
    const n = Number(cash[1]);
    out.push({
      label: "Cash",
      value: Number.isFinite(n) ? n.toFixed(2) : cash[1]!,
      tone: !Number.isFinite(n) || n >= 0.5 ? "ok" : n >= 0.25 ? "warn" : "risk",
    });
  }
  return out;
}

export function MobileBetaLiquidityBadges({ simRow }: { simRow: Record<string, unknown> }) {
  const { lang } = useMobileLang();
  const it = lang === "it";
  const beta = resolveSimRowBeta(simRow);
  const liqScore = resolveSimRowLiquidityScore(simRow);
  const fyDisplay = resolveSimRowLiquiditaFy(simRow);
  const liqChips = fyDisplay ? parseLiqChips(fyDisplay) : [];
  const betaUi = beta != null ? betaDisplay(beta) : null;
  const liqStyle = liqScore != null ? liquidityBarStyle(liqScore) : null;

  return (
    <div className="mob-beta-liq-row">
      <div className="mob-beta-liq-card">
        <p className="mob-beta-liq-label">Beta</p>
        {betaUi ? (
          <>
            <p className="mob-beta-liq-val" style={{ color: betaUi.color, fontWeight: betaUi.weight }}>
              {betaUi.text}
              {betaUi.icon ? <span className="mob-beta-liq-icon">{betaUi.icon}</span> : null}
            </p>
            <p className="mob-beta-liq-hint">{betaBucketLabel(betaUi.bucket, it)}</p>
          </>
        ) : (
          <p className="mob-beta-liq-val mob-beta-liq-val--empty">—</p>
        )}
      </div>

      <div className="mob-beta-liq-card mob-beta-liq-card--liq">
        <p className="mob-beta-liq-label">{it ? "Liquidità" : "Liquidity"}</p>
        {liqScore != null && liqStyle ? (
          <p className="mob-beta-liq-val mob-beta-liq-val--liq" style={liqStyle}>
            {liqScore.toFixed(2)}
          </p>
        ) : (
          <p className="mob-beta-liq-val mob-beta-liq-val--empty">—</p>
        )}
        {liqChips.length ? (
          <div className="mob-beta-liq-chips">
            {liqChips.map((chip) => (
              <span key={chip.label} className={`mob-beta-liq-chip ${LIQ_CHIP_TONE[chip.tone]}`}>
                <span>{chip.label}</span>
                <span>{chip.value}</span>
              </span>
            ))}
          </div>
        ) : fyDisplay ? (
          <p className="mob-beta-liq-fy hint">{fyDisplay}</p>
        ) : null}
      </div>
    </div>
  );
}
