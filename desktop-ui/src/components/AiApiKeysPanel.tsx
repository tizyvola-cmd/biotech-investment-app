import { useCallback, useEffect, useState } from "react";
import {
  fetchAiProviderInfo,
  fetchAiSecretsStatus,
  probeAiProvider,
  saveAiSecrets,
  setAiProvider,
  type AiProviderId,
  type AiProviderInfo,
  type AiSecretsStatus,
} from "../api/supernova";
import { useLang, useT } from "../shared/i18n";

export function AiApiKeysPanel({
  onProviderUpdate,
  openProviderHint,
  onClearProviderHint,
}: {
  onProviderUpdate?: (info: AiProviderInfo) => void;
  /** Apre il pannello e mette a fuoco il campo del provider richiesto. */
  openProviderHint?: AiProviderId | null;
  onClearProviderHint?: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [status, setStatus] = useState<AiSecretsStatus | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [prepaidEur, setPrepaidEur] = useState("");
  const [orgId, setOrgId] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchAiSecretsStatus();
      setStatus(s);
      if (s.anthropic_prepaid_eur != null && Number.isFinite(s.anthropic_prepaid_eur)) {
        setPrepaidEur(String(s.anthropic_prepaid_eur));
      }
      if (s.anthropic_org_id) setOrgId(s.anthropic_org_id);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!openProviderHint) return;
    setOpen(true);
    if (openProviderHint === "github" || openProviderHint === "openai") {
      setMoreOpen(true);
    }
    onClearProviderHint?.();
  }, [openProviderHint, onClearProviderHint]);

  const anthropicSet = status?.providers?.anthropic?.set ?? false;
  const anthropicMasked = status?.providers?.anthropic?.masked ?? "";
  const githubSet = status?.providers?.github?.set ?? false;
  const githubMasked = status?.providers?.github?.masked ?? "";

  async function handleSave() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const body: Parameters<typeof saveAiSecrets>[0] = {};
      if (anthropicKey.trim()) body.anthropic_api_key = anthropicKey.trim();
      if (openaiKey.trim()) body.openai_api_key = openaiKey.trim();
      if (githubToken.trim()) body.github_token = githubToken.trim();
      const prepaidTrim = prepaidEur.trim().replace(",", ".");
      if (prepaidTrim) {
        const n = Number(prepaidTrim);
        if (Number.isFinite(n) && n >= 0) body.anthropic_prepaid_eur = n;
      }
      if (orgId.trim()) body.anthropic_org_id = orgId.trim();
      if (
        !anthropicKey.trim() &&
        !openaiKey.trim() &&
        !githubToken.trim() &&
        !prepaidTrim &&
        !orgId.trim()
      ) {
        setErr(it ? "Incolla almeno una chiave o i crediti € prima di salvare." : "Paste at least a key or € credits before saving.");
        return;
      }
      const res = await saveAiSecrets(body);
      setStatus(res);
      setAnthropicKey("");
      setOpenaiKey("");
      setGithubToken("");
      setMsg(
        prepaidTrim
          ? it
            ? "Salvato — saldo aggiornato dai crediti caricati."
            : "Saved — balance updated from loaded credits."
          : it
            ? "Chiavi salvate sul server API."
            : "Keys saved on the API server.",
      );
      if (githubToken.trim()) {
        try {
          await setAiProvider("github");
          setMsg(
            it
              ? "GitHub salvato e Copilot attivato — puoi «Arricchisci portfolio»."
              : "GitHub saved and Copilot activated — you can run «Enrich portfolio».",
          );
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      } else if (anthropicKey.trim()) {
        try {
          await setAiProvider("anthropic");
        } catch {
          /* provider switch optional */
        }
      }
      const info = res.provider ?? (await fetchAiProviderInfo());
      onProviderUpdate?.(info);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAnthropic() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await saveAiSecrets({ clear_anthropic: true });
      setStatus(res);
      setAnthropicKey("");
      const info = res.provider ?? (await fetchAiProviderInfo());
      onProviderUpdate?.(info);
      setMsg(it ? "Chiave Claude rimossa." : "Claude key removed.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await probeAiProvider();
      onProviderUpdate?.(res);
      if (res.probe_ok) {
        setMsg(it ? "Test OK — Claude/API risponde." : "Test OK — API responded.");
      } else {
        setErr(
          res.hint_it && it
            ? res.hint_it
            : res.hint_en ?? (it ? "Test fallito — controlla crediti e chiave." : "Test failed — check credits and key."),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/40 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-semibold text-ink hover:bg-surface/80"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t("clinicalFeed.apiKeys.title")}</span>
        <span className="text-ink-muted font-normal shrink-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 justify-end">
          {anthropicSet ? (
            <span className="text-violet-400">
              Claude {anthropicMasked ? `· ${anthropicMasked}` : "✓"}
            </span>
          ) : (
            <span className="text-negative/90">{t("clinicalFeed.apiKeys.notSet")}</span>
          )}
          {githubSet ? (
            <span className="text-blue-400">
              Copilot {githubMasked ? `· ${githubMasked}` : "✓"}
            </span>
          ) : (
            <span className="text-ink-muted/70">{t("clinicalFeed.apiKeys.copilotNotSet")}</span>
          )}
          <span className="ml-2">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open ? (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-[rgb(var(--border))]/30">
          <p className="text-[10px] text-ink-muted leading-snug">{t("clinicalFeed.apiKeys.hint")}</p>

          <label className="block">
            <span className="text-[10px] font-medium text-violet-300">
              {t("clinicalFeed.apiKeys.anthropicLabel")}
            </span>
            <input
              type="password"
              autoComplete="off"
              className="feed-panel-input w-full mt-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono"
              placeholder={anthropicSet ? anthropicMasked || "sk-ant-…" : "sk-ant-api03-…"}
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-medium text-violet-300">
              {t("clinicalFeed.apiKeys.prepaidLabel")}
            </span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className="feed-panel-input w-full mt-1 rounded-lg px-2.5 py-1.5 text-[11px] tabular-nums"
              placeholder="25"
              value={prepaidEur}
              onChange={(e) => setPrepaidEur(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-medium text-ink-muted">
              {t("clinicalFeed.apiKeys.orgIdLabel")}
            </span>
            <p className="text-[9px] text-ink-muted/85 mt-0.5 leading-snug">
              {t("clinicalFeed.apiKeys.orgIdHint")}
            </p>
            <input
              type="text"
              autoComplete="off"
              className="feed-panel-input w-full mt-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            />
          </label>

          <button
            type="button"
            className="text-[10px] text-ink-muted hover:text-ink"
            onClick={() => setMoreOpen((v) => !v)}
          >
            {moreOpen ? "▾" : "▸"} {t("clinicalFeed.apiKeys.moreProviders")}
          </button>
          {moreOpen ? (
            <div className="space-y-2">
              <label className="block">
                <span className="text-ink-muted">OpenAI</span>
                <input
                  type="password"
                  autoComplete="off"
                  className="feed-panel-input w-full mt-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono"
                  placeholder="sk-…"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-blue-300 font-medium">
                  {t("clinicalFeed.apiKeys.githubLabel")}
                </span>
                <p className="text-[9px] text-ink-muted/85 mt-0.5 leading-snug">
                  {t("clinicalFeed.apiKeys.githubHint")}
                </p>
                <input
                  type="password"
                  autoComplete="off"
                  className="feed-panel-input w-full mt-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono"
                  placeholder={githubSet ? githubMasked || "github_pat_…" : "github_pat_…"}
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5 items-center">
            <button
              type="button"
              className="btn-primary text-[10px] px-2.5 py-1"
              disabled={busy}
              onClick={() => void handleSave()}
            >
              {busy ? "…" : t("clinicalFeed.apiKeys.save")}
            </button>
            <button
              type="button"
              className="btn-ghost text-[10px] px-2.5 py-1"
              disabled={busy || !anthropicSet}
              onClick={() => void handleTest()}
            >
              {t("clinicalFeed.apiKeys.test")}
            </button>
            {anthropicSet ? (
              <button
                type="button"
                className="btn-ghost text-[10px] px-2.5 py-1 text-negative/90"
                disabled={busy}
                onClick={() => void handleClearAnthropic()}
              >
                {t("clinicalFeed.apiKeys.clearClaude")}
              </button>
            ) : null}
            <a
              href={status?.anthropic_console_url ?? "https://console.anthropic.com/settings/billing"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-violet-400 hover:underline ml-auto"
            >
              {t("clinicalFeed.apiKeys.billing")} ↗
            </a>
          </div>

          {msg ? <p className="text-[10px] text-positive">{msg}</p> : null}
          {err ? <p className="text-[10px] text-negative leading-snug">{err}</p> : null}
        </div>
      ) : null}
    </div>
  );

}
