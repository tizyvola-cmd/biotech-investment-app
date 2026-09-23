import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAiProviderInfo,
  probeAiProvider,
  setAiProvider,
  type AiProviderId,
  type AiProviderInfo,
  type AiUsageSummary,
} from "../api/supernova";
import { useLang, useT } from "../shared/i18n";

const PROVIDER_META: Record<
  AiProviderId,
  { name: string; icon: string; activeCls: string; usageAccent: string }
> = {
  anthropic: {
    name: "Claude",
    icon: "🟣",
    activeCls: "border-violet-500/60 bg-violet-500/15 text-violet-300",
    usageAccent: "text-violet-400",
  },
  gemini: {
    name: "Gemini",
    icon: "🟡",
    activeCls: "border-amber-500/55 bg-amber-500/12 text-amber-200",
    usageAccent: "text-amber-400",
  },
  openai: {
    name: "GPT-4o",
    icon: "🟢",
    activeCls: "border-emerald-500/50 bg-emerald-500/12 text-emerald-300",
    usageAccent: "text-emerald-400",
  },
  github: {
    name: "Copilot",
    icon: "🔵",
    activeCls: "border-blue-500/50 bg-blue-500/12 text-blue-300",
    usageAccent: "text-blue-400",
  },
};

function ProviderUsageStrip({
  provider,
  usage,
  info,
  it,
  onRefreshBalance,
  refreshing,
}: {
  provider: AiProviderId;
  usage: AiUsageSummary | undefined;
  info: AiProviderInfo | null;
  it: boolean;
  onRefreshBalance?: () => void;
  refreshing?: boolean;
}) {
  const t = useT();
  const accent = PROVIDER_META[provider].usageAccent;

  if (provider === "github" || provider === "openai") {
    const label = provider === "github" ? "Copilot / GitHub Models" : "GPT-4o / OpenAI";
    return (
      <div className="flex items-center gap-3 text-[10px] text-amber-500/95 flex-wrap leading-snug">
        <span>
          {it
            ? `${label} non è più selezionabile — passa a Claude o Gemini (gratis).`
            : `${label} is no longer selectable — switch to Claude or Gemini (free).`}
        </span>
      </div>
    );
  }

  if (provider === "gemini") {
    return (
      <div className="flex items-center gap-3 text-[10px] text-ink-muted/90 flex-wrap leading-snug">
        {usage && usage.calls > 0 ? (
          <>
            <span>
              {usage.calls} {it ? "chiamate" : "calls"}
              {usage.input_tokens > 0
                ? ` · ${(usage.input_tokens / 1000).toFixed(0)}k in · ${(usage.output_tokens / 1000).toFixed(0)}k out`
                : ""}
            </span>
            <span className={`font-semibold ${accent}`}>
              {it ? "free tier AI Studio" : "AI Studio free tier"}
            </span>
          </>
        ) : (
          <span>
            {it
              ? "Nessuna chiamata Gemini negli ultimi 30 gg — chiave gratis su aistudio.google.com/apikey"
              : "No Gemini calls in the last 30 days — free key at aistudio.google.com/apikey"}
          </span>
        )}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className={`${accent} hover:underline font-semibold shrink-0`}
        >
          {it ? "→ Gemini API key ↗" : "→ Gemini API key ↗"}
        </a>
      </div>
    );
  }

  // Detect credit exhaustion from last errors
  const lastErr = info?.errors?.anthropic ?? "";
  const creditExhausted =
    typeof lastErr === "string" &&
    (lastErr.toLowerCase().includes("credit balance") ||
      lastErr.toLowerCase().includes("too low") ||
      lastErr.toLowerCase().includes("insufficient"));

  return (
    <div className="flex flex-col gap-1">
      {/* Credit exhaustion alert */}
      {creditExhausted ? (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/30">
          <span className="text-red-500 text-xs font-bold shrink-0">⚠</span>
          <span className="text-[10px] text-red-400 font-semibold leading-snug">
            {it
              ? "Crediti Anthropic esauriti — passa a Gemini (gratis) o ricarica i crediti Claude."
              : "Anthropic credits exhausted — switch to Gemini (free) or top up Claude credits."}
          </span>
          <a
            href={info?.anthropic_console_url ?? "https://console.anthropic.com/settings/billing"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-red-400 hover:text-red-300 hover:underline font-bold text-[10px] shrink-0 whitespace-nowrap"
          >
            {it ? "Ricarica ↗" : "Top up ↗"}
          </a>
        </div>
      ) : null}

      {/* Balance + usage row */}
      <div className="flex items-center gap-3 text-[10px] text-ink-muted/90 flex-wrap leading-snug">
        {(() => {
          const bal = info?.anthropic_balance;
          const rem = bal?.remaining_eur;

          // Real-time balance available
          if (rem != null && Number.isFinite(rem)) {
            const isLow = rem < 1;
            const balCls = isLow
              ? "font-bold text-red-400"
              : `font-semibold ${accent}`;
            return (
              <span className={balCls}>
                {bal?.source === "live"
                  ? t("clinicalFeed.apiKeys.balanceLive", { eur: rem.toFixed(2) })
                  : t("clinicalFeed.apiKeys.balanceEstimated", {
                      eur: rem.toFixed(2),
                      prepaid: String(bal?.prepaid_eur?.toFixed(2) ?? "—"),
                      spent: String(bal?.spent_eur?.toFixed(2) ?? "0"),
                    })}
                {isLow ? (it ? " ⚠ basso" : " ⚠ low") : ""}
              </span>
            );
          }

          // No balance info but credit exhausted detected from error
          if (creditExhausted) {
            return (
              <span className="font-bold text-red-400">
                {it ? "Saldo: €0.00 (esaurito)" : "Balance: €0.00 (exhausted)"}
              </span>
            );
          }

          // Fallback: show cost estimate
          if (usage && usage.calls > 0) {
            return (
              <span className={`font-semibold ${accent}`}>
                ${usage.cost_usd.toFixed(3)} ({it ? "30 gg stim." : "30d est."})
              </span>
            );
          }
          return <span>{t("clinicalFeed.apiKeys.balanceUnset")}</span>;
        })()}
        {usage && usage.calls > 0 ? (
          <span>
            {usage.calls} {it ? "chiamate" : "calls"} ·{" "}
            {(usage.input_tokens / 1000).toFixed(0)}k in · {(usage.output_tokens / 1000).toFixed(0)}k out
          </span>
        ) : null}
        <a
          href={info?.anthropic_console_url ?? "https://console.anthropic.com/settings/billing"}
          target="_blank"
          rel="noopener noreferrer"
          className={`${accent} hover:underline font-semibold shrink-0`}
        >
          {it ? "→ Gestisci crediti Anthropic ↗" : "→ Manage Anthropic credits ↗"}
        </a>
        {onRefreshBalance ? (
          <button
            type="button"
            disabled={refreshing}
            onClick={onRefreshBalance}
            className={`${accent} hover:underline font-semibold shrink-0 text-[10px] ${
              refreshing ? "opacity-50 cursor-wait" : ""
            }`}
            title={it ? "Verifica stato crediti in tempo reale" : "Check credit status in real time"}
          >
            {refreshing
              ? (it ? "⟳ Verifica…" : "⟳ Checking…")
              : (it ? "⟳ Verifica saldo" : "⟳ Check balance")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AiProviderSwitch({
  info,
  onUpdated,
  onNeedKey,
}: {
  info: AiProviderInfo | null;
  onUpdated?: (info: AiProviderInfo) => void;
  /** Apre pannello chiavi quando l'utente clicca un provider non configurato. */
  onNeedKey?: (provider: AiProviderId) => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [loading, setLoading] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const probedRef = useRef(false);

  const activeRaw = (info?.provider ?? info?.session ?? info?.active ?? "anthropic") as AiProviderId;
  const active: AiProviderId =
    activeRaw === "github" || activeRaw === "openai" ? "anthropic" : activeRaw;
  const configured = new Set(info?.configured ?? []);
  if (info?.secrets?.providers?.gemini?.set) configured.add("gemini");
  if (info?.secrets?.providers?.anthropic?.set) configured.add("anthropic");
  const migratedAwayRef = useRef(false);

  // Detect per-provider credit issues from errors
  const providerCreditIssue = (p: AiProviderId): boolean => {
    const err = info?.errors?.[p] ?? "";
    return (
      typeof err === "string" &&
      (err.toLowerCase().includes("credit balance") ||
        err.toLowerCase().includes("too low") ||
        err.toLowerCase().includes("insufficient"))
    );
  };

  // Auto-probe on first mount if no balance info and Anthropic active
  const handleBalanceRefresh = useCallback(async () => {
    if (probing) return;
    setProbing(true);
    try {
      const result = await probeAiProvider();
      if (result) onUpdated?.(result);
    } catch { /* ignore */ }
    finally { setProbing(false); }
  }, [probing, onUpdated]);

  // Leave retired Copilot/OpenAI sessions automatically.
  useEffect(() => {
    if (migratedAwayRef.current) return;
    if (activeRaw !== "github" && activeRaw !== "openai") return;
    migratedAwayRef.current = true;
    const prefer: AiProviderId | null = configured.has("gemini")
      ? "gemini"
      : configured.has("anthropic")
        ? "anthropic"
        : null;
    if (!prefer) {
      onNeedKey?.("gemini");
      setSwitchError(
        it
          ? "Copilot non è più disponibile. Incolla la chiave Gemini sotto e premi «Salva chiavi» (non «Test API»)."
          : "Copilot is no longer available. Paste the Gemini key below and click «Save keys» (not «Test API»).",
      );
      return;
    }
    void (async () => {
      try {
        await setAiProvider(prefer);
        onUpdated?.(await fetchAiProviderInfo());
      } catch {
        onNeedKey?.("gemini");
      }
    })();
  }, [activeRaw]);

  useEffect(() => {
    if (configured.has("gemini") || configured.has("anthropic")) {
      setSwitchError((prev) =>
        prev && /salva|save keys|incolla|paste the gemini|copilot non/i.test(prev) ? null : prev,
      );
    }
  }, [info?.configured, info?.secrets]);

  useEffect(() => {
    if (probedRef.current) return;
    const bal = info?.anthropic_balance;
    const hasBalance = bal?.remaining_eur != null && Number.isFinite(bal.remaining_eur);
    const hasErrors = Object.keys(info?.errors ?? {}).length > 0;
    // Auto-probe only once if balance unknown and no errors populated yet
    if (active === "anthropic" && !hasBalance && !hasErrors && info?.configured?.includes("anthropic")) {
      probedRef.current = true;
      void handleBalanceRefresh();
    }
  }, [active, info, handleBalanceRefresh]);

  async function handleSwitch(p: AiProviderId) {
    if (p === active && activeRaw !== "github" && activeRaw !== "openai") return;
    if (loading) return;
    setSwitchError(null);
    if (!configured.has(p)) {
      onNeedKey?.(p);
      setSwitchError(
        p === "gemini"
          ? it
            ? "Incolla la chiave Gemini nel campo sotto, poi premi «Salva chiavi» (non «Test API»)."
            : "Paste the Gemini key in the field below, then click «Save keys» (not «Test API»)."
          : it
            ? `Chiave ${PROVIDER_META[p].name} mancante sul server — apri «Chiavi API».`
            : `${PROVIDER_META[p].name} key missing on server — open «API keys».`,
      );
      return;
    }
    setLoading(true);
    try {
      const res = await setAiProvider(p);
      if (res?.ok === false) {
        setSwitchError(
          String(res.error ?? (it ? "Cambio provider fallito." : "Provider switch failed.")),
        );
        return;
      }
      const fresh = await fetchAiProviderInfo();
      onUpdated?.(fresh);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwitchError(
        msg.includes("401") || msg.toLowerCase().includes("token")
          ? it
            ? "Token API mancante o errato — Impostazioni → Token SuperNova (serve per cambiare provider sul VPS)."
            : "Missing or invalid API token — Settings → SuperNova token (required to switch provider on VPS)."
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-ink-muted font-medium shrink-0">
          {it ? "Provider AI:" : "AI provider:"}
        </span>
        {(["anthropic", "gemini"] as const).map((p) => {
          const meta = PROVIDER_META[p];
          const isActive = p === active;
          const ok = configured.has(p);
          const pUsage = info?.usage_30d?.[p];
          const hasCreditsIssue = ok && providerCreditIssue(p);
          const callBadge =
            pUsage && pUsage.calls > 0 ? (
              <span className="ml-1 opacity-75 font-normal">({pUsage.calls})</span>
            ) : null;
          return (
            <button
              key={p}
              type="button"
              disabled={loading}
              title={
                hasCreditsIssue
                  ? it
                    ? `${meta.name} — crediti esauriti`
                    : `${meta.name} — credits exhausted`
                  : ok
                    ? pUsage?.calls
                      ? `${meta.name} · ${pUsage.calls} calls (30d)`
                      : meta.name
                    : it
                      ? "Chiave mancante sul server — clicca per aprire Chiavi API"
                      : "Key missing on server — click to open API keys"
              }
              onClick={() => void handleSwitch(p)}
              className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold transition ${
                isActive && hasCreditsIssue
                  ? "border-red-500/60 bg-red-500/15 text-red-300"
                  : isActive
                    ? meta.activeCls
                    : ok
                      ? "border-[rgb(var(--border))]/40 text-ink-muted hover:text-ink hover:border-[rgb(var(--border))]"
                      : "border-dashed border-[rgb(var(--border))]/45 text-ink-muted/70 hover:text-ink hover:border-[rgb(var(--border))]"
              } ${loading ? "opacity-50 cursor-wait" : ""}`}
            >
              {hasCreditsIssue ? "🔴" : meta.icon} {meta.name}
              {callBadge}
              {hasCreditsIssue ? (
                <span className="ml-1 font-normal text-red-400 text-[9px]">
                  {it ? "· esaurito" : "· exhausted"}
                </span>
              ) : !ok ? (
                <span className="ml-1 font-normal opacity-80">
                  {it ? "· configura" : "· setup"}
                </span>
              ) : null}
            </button>
          );
        })}
        {loading ? (
          <span className="text-[10px] text-ink-muted">{it ? "Cambio…" : "Switching…"}</span>
        ) : null}
      </div>

      {switchError ? (
        <p className="text-[10px] text-negative leading-snug" role="alert">
          {switchError}
        </p>
      ) : null}

      <ProviderUsageStrip
        provider={activeRaw}
        usage={info?.usage_30d?.[activeRaw]}
        info={info}
        it={it}
        onRefreshBalance={active === "anthropic" ? handleBalanceRefresh : undefined}
        refreshing={probing}
      />
    </div>
  );
}
