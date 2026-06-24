import { useState } from "react";
import {
  fetchAiProviderInfo,
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
}: {
  provider: AiProviderId;
  usage: AiUsageSummary | undefined;
  info: AiProviderInfo | null;
  it: boolean;
}) {
  const t = useT();
  const accent = PROVIDER_META[provider].usageAccent;

  if (provider === "github") {
    return (
      <div className="flex items-center gap-3 text-[10px] text-ink-muted/90 flex-wrap leading-snug">
        {usage && usage.calls > 0 ? (
          <>
            <span>
              {usage.calls} {it ? "chiamate" : "calls"} ·{" "}
              {(usage.input_tokens / 1000).toFixed(0)}k in ·{" "}
              {(usage.output_tokens / 1000).toFixed(0)}k out
            </span>
            <span className={`font-semibold ${accent}`}>
              {it ? "incluso Copilot" : "Copilot included"}
              {usage.cost_usd > 0
                ? ` · ~$${usage.cost_usd.toFixed(3)} ${it ? "stima ref." : "ref. est."}`
                : ""}
            </span>
          </>
        ) : (
          <span>
            {it
              ? "Nessuna chiamata Copilot negli ultimi 30 gg — seleziona Copilot e «Arricchisci portfolio»"
              : "No Copilot calls in the last 30 days — select Copilot and run «Enrich portfolio»"}
          </span>
        )}
        <a
          href="https://github.com/settings/copilot"
          target="_blank"
          rel="noopener noreferrer"
          className={`${accent} hover:underline font-semibold shrink-0`}
        >
          {it ? "→ Impostazioni Copilot ↗" : "→ Copilot settings ↗"}
        </a>
        {info?.github_rate_limited ? (
          <span className="text-amber-600 font-medium">
            {it ? "Rate limit — attendi" : "Rate limited — wait"}{" "}
            {Math.ceil(info.github_cooldown_s ?? 0)}s
          </span>
        ) : null}
      </div>
    );
  }

  if (provider === "openai") {
    return (
      <div className="flex items-center gap-3 text-[10px] text-ink-muted/90 flex-wrap leading-snug">
        {usage && usage.calls > 0 ? (
          <>
            <span>
              {usage.calls} {it ? "chiamate" : "calls"} ·{" "}
              {(usage.input_tokens / 1000).toFixed(0)}k in ·{" "}
              {(usage.output_tokens / 1000).toFixed(0)}k out
            </span>
            <span className={`font-semibold ${accent}`}>
              ${usage.cost_usd.toFixed(3)} ({it ? "30 gg stim." : "30d est."})
            </span>
          </>
        ) : (
          <span>
            {it
              ? "Nessun utilizzo OpenAI negli ultimi 30 giorni"
              : "No OpenAI usage in the last 30 days"}
          </span>
        )}
        <a
          href="https://platform.openai.com/usage"
          target="_blank"
          rel="noopener noreferrer"
          className={`${accent} hover:underline font-semibold shrink-0`}
        >
          {it ? "→ Usage OpenAI ↗" : "→ OpenAI usage ↗"}
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-[10px] text-ink-muted/90 flex-wrap leading-snug">
      {(() => {
        const bal = info?.anthropic_balance;
        const rem = bal?.remaining_eur;
        if (rem != null && Number.isFinite(rem)) {
          return (
            <span className={`font-semibold ${accent}`}>
              {bal?.source === "live"
                ? t("clinicalFeed.apiKeys.balanceLive", { eur: rem.toFixed(2) })
                : t("clinicalFeed.apiKeys.balanceEstimated", {
                    eur: rem.toFixed(2),
                    prepaid: String(bal?.prepaid_eur?.toFixed(2) ?? "—"),
                    spent: String(bal?.spent_eur?.toFixed(2) ?? "0"),
                  })}
            </span>
          );
        }
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

  const active = (info?.provider ?? info?.session ?? info?.active ?? "anthropic") as AiProviderId;
  const configured = new Set(info?.configured ?? []);
  const usage = info?.usage_30d?.[active];

  async function handleSwitch(p: AiProviderId) {
    if (p === active || loading) return;
    setSwitchError(null);
    if (!configured.has(p)) {
      onNeedKey?.(p);
      setSwitchError(
        p === "github"
          ? it
            ? "Copilot: incolla GITHUB_TOKEN (PAT con permesso Models) nel pannello «Chiavi API» sotto."
            : "Copilot: paste GITHUB_TOKEN (PAT with Models permission) in the «API keys» panel below."
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
        {(["anthropic", "openai", "github"] as const).map((p) => {
          const meta = PROVIDER_META[p];
          const isActive = p === active;
          const ok = configured.has(p);
          const pUsage = info?.usage_30d?.[p];
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
                ok
                  ? pUsage?.calls
                    ? `${meta.name} · ${pUsage.calls} calls (30d)`
                    : meta.name
                  : it
                    ? "Chiave mancante sul server — clicca per aprire Chiavi API"
                    : "Key missing on server — click to open API keys"
              }
              onClick={() => void handleSwitch(p)}
              className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold transition ${
                isActive
                  ? meta.activeCls
                  : ok
                    ? "border-[rgb(var(--border))]/40 text-ink-muted hover:text-ink hover:border-[rgb(var(--border))]"
                    : "border-dashed border-[rgb(var(--border))]/45 text-ink-muted/70 hover:text-ink hover:border-[rgb(var(--border))]"
              } ${loading ? "opacity-50 cursor-wait" : ""}`}
            >
              {meta.icon} {meta.name}
              {callBadge}
              {!ok ? (
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

      <ProviderUsageStrip provider={active} usage={usage} info={info} it={it} />
    </div>
  );
}
