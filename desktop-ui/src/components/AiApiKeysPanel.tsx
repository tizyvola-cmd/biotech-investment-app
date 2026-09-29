import { useCallback, useEffect, useRef, useState } from "react";
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

function readInputValue(ref: { current: HTMLInputElement | null }): string {
  // Uncontrolled inputs: read DOM so browser autofill is included even without onChange.
  return ref.current?.value?.trim() ?? "";
}

export function AiApiKeysPanel({
  onProviderUpdate,
  openProviderHint,
  onClearProviderHint,
  defaultOpen = false,
}: {
  onProviderUpdate?: (info: AiProviderInfo) => void;
  /** Apre il pannello e mette a fuoco il campo del provider richiesto. */
  openProviderHint?: AiProviderId | null;
  onClearProviderHint?: () => void;
  /** System tab: start expanded. */
  defaultOpen?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const [open, setOpen] = useState(defaultOpen);
  const [status, setStatus] = useState<AiSecretsStatus | null>(null);
  const [prepaidEur, setPrepaidEur] = useState("");
  const [orgId, setOrgId] = useState("");
  /** Bump to remount password inputs after save/clear (uncontrolled + autofill-safe). */
  const [keyFieldsEpoch, setKeyFieldsEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const anthropicRef = useRef<HTMLInputElement | null>(null);
  const geminiRef = useRef<HTMLInputElement | null>(null);

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
    onClearProviderHint?.();
    window.setTimeout(() => {
      if (openProviderHint === "gemini") geminiRef.current?.focus();
      else if (openProviderHint === "anthropic") anthropicRef.current?.focus();
      else geminiRef.current?.focus();
    }, 50);
  }, [openProviderHint, onClearProviderHint]);

  const anthropicSet = status?.providers?.anthropic?.set ?? false;
  const anthropicMasked = status?.providers?.anthropic?.masked ?? "";
  const geminiSet = status?.providers?.gemini?.set ?? false;
  const geminiMasked = status?.providers?.gemini?.masked ?? "";

  async function handleSave() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const anthropicVal = readInputValue(anthropicRef);
      const geminiVal = readInputValue(geminiRef);
      const body: Parameters<typeof saveAiSecrets>[0] = {};
      if (anthropicVal) body.anthropic_api_key = anthropicVal;
      if (geminiVal) body.gemini_api_key = geminiVal;
      const prepaidTrim = prepaidEur.trim().replace(",", ".");
      if (prepaidTrim) {
        const n = Number(prepaidTrim);
        if (Number.isFinite(n) && n >= 0) body.anthropic_prepaid_eur = n;
      }
      if (orgId.trim()) body.anthropic_org_id = orgId.trim();
      if (!anthropicVal && !geminiVal && !prepaidTrim && !orgId.trim()) {
        setErr(
          it
            ? "Incolla almeno una chiave (Claude o Gemini) o i crediti € prima di salvare."
            : "Paste at least one key (Claude or Gemini) or € credits before saving.",
        );
        return;
      }
      const res = await saveAiSecrets(body);
      setStatus(res);
      const savedGemini = Boolean(geminiVal);
      const savedAnthropic = Boolean(anthropicVal);
      setKeyFieldsEpoch((n) => n + 1);

      if (savedGemini && !res.providers?.gemini?.set) {
        setErr(
          it
            ? "Il server non ha salvato Gemini — riavvia l’API con il codice aggiornato (google-genai + gemini_api_key), poi riprova."
            : "Server did not persist Gemini — restart the API with the updated code (google-genai + gemini_api_key), then retry.",
        );
        onProviderUpdate?.(res.provider ?? (await fetchAiProviderInfo()));
        return;
      }

      setMsg(
        prepaidTrim && !savedGemini && !savedAnthropic
          ? it
            ? "Salvato — saldo aggiornato dai crediti caricati."
            : "Saved — balance updated from loaded credits."
          : it
            ? "Chiavi salvate sul server API."
            : "Keys saved on the API server.",
      );
      if (savedGemini) {
        try {
          await setAiProvider("gemini");
          setMsg(
            it
              ? "Gemini salvato e attivato (free tier AI Studio)."
              : "Gemini saved and activated (AI Studio free tier).",
          );
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      } else if (savedAnthropic) {
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
      setKeyFieldsEpoch((n) => n + 1);
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
      // If Gemini is typed but not saved yet, save+activate first (avoids testing dead Copilot).
      const geminiVal = readInputValue(geminiRef);
      if (geminiVal && !geminiSet) {
        const res = await saveAiSecrets({ gemini_api_key: geminiVal });
        setStatus(res);
        setKeyFieldsEpoch((n) => n + 1);
        if (!res.providers?.gemini?.set) {
          setErr(
            it
              ? "Il server non ha salvato Gemini — riavvia l’API aggiornata, poi riprova."
              : "Server did not persist Gemini — restart the updated API, then retry.",
          );
          return;
        }
        await setAiProvider("gemini");
      }
      const res = await probeAiProvider();
      onProviderUpdate?.(res);
      if (res.probe_ok) {
        setMsg(it ? "Test OK — Gemini/Claude risponde." : "Test OK — Gemini/Claude responded.");
        setErr(null);
      } else {
        const geminiErr = String(res.errors?.gemini ?? "");
        const raw =
          res.hint_it && it
            ? res.hint_it
            : res.hint_en ?? (it ? "Test fallito — controlla crediti e chiave." : "Test failed — check credits and key.");
        // Prefer the active/Gemini error; don't blame Copilot if Gemini is already saved.
        if (geminiSet || geminiVal) {
          setErr(
            geminiErr
              ? it
                ? `Gemini: ${geminiErr.slice(0, 220)}`
                : `Gemini: ${geminiErr.slice(0, 220)}`
              : raw,
          );
        } else if (/github.?models|retirement|410/i.test(raw) && !/gemini/i.test(raw)) {
          setErr(
            it
              ? "Copilot non funziona più. Salva Gemini con «Salva e attiva Gemini», poi riprova Test."
              : "Copilot no longer works. Save Gemini with «Save & activate Gemini», then Test again.",
          );
        } else {
          setErr(raw);
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (/github.?models|retirement|410/i.test(raw)) {
        setErr(
          it
            ? "Copilot non funziona più. Salva Gemini con «Salva chiavi», poi riprova Test."
            : "Copilot no longer works. Save Gemini with «Save keys», then Test again.",
        );
      } else {
        setErr(raw);
      }
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
          {geminiSet ? (
            <span className="text-amber-400">
              Gemini {geminiMasked ? `· ${geminiMasked}` : "✓"}
            </span>
          ) : (
            <span className="text-ink-muted/70">
              {it ? "Gemini non configurato" : "Gemini not set"}
            </span>
          )}
          {anthropicSet ? (
            <span className="text-violet-400">
              Claude {anthropicMasked ? `· ${anthropicMasked}` : "✓"}
            </span>
          ) : (
            <span className="text-negative/90">{t("clinicalFeed.apiKeys.notSet")}</span>
          )}
          <span className="ml-2">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open ? (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-[rgb(var(--border))]/30">
          <p className="text-[10px] text-ink-muted leading-snug">
            {it
              ? "Le chiavi si salvano sul server API (data/ai_secrets.json). Claude = qualità (a pagamento). Gemini = free tier, fallback per 8-K / briefing se Claude non c’è."
              : "Keys are saved on the API server (data/ai_secrets.json). Claude = quality (paid). Gemini = free tier fallback for 8-K / briefings when Claude is off."}
          </p>

          <label className="block rounded-lg border border-violet-500/35 bg-violet-500/5 px-2.5 py-2">
            <span className="text-[10px] font-semibold text-violet-300">
              {t("clinicalFeed.apiKeys.anthropicLabel")}
            </span>
            <p className="text-[9px] text-ink-muted/90 mt-0.5 leading-snug">
              {it
                ? "Incolla la chiave da console.anthropic.com, poi Salva."
                : "Paste the key from console.anthropic.com, then Save."}
            </p>
            <input
              key={`anthropic-${keyFieldsEpoch}`}
              ref={anthropicRef}
              type="password"
              autoComplete="new-password"
              name="sn_anthropic_api_key"
              data-1p-ignore
              data-lpignore="true"
              className="feed-panel-input w-full mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-mono"
              placeholder={anthropicSet ? anthropicMasked || "sk-ant-…" : "sk-ant-api03-…"}
              defaultValue=""
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

          <label className="block rounded-lg border border-amber-500/35 bg-amber-500/5 px-2.5 py-2">
            <span className="text-[10px] font-semibold text-amber-300">
              Gemini (Flash · free) — {it ? "opzionale" : "optional"}
            </span>
            <p className="text-[9px] text-ink-muted/90 mt-0.5 leading-snug">
              {it
                ? "Non obbligatoria se usi Claude. Utile come fallback gratis (aistudio.google.com/apikey)."
                : "Not required if you use Claude. Useful free fallback (aistudio.google.com/apikey)."}
            </p>
            <input
              key={`gemini-${keyFieldsEpoch}`}
              ref={geminiRef}
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              name="sn_gemini_api_key"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              className="feed-panel-input w-full mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-mono"
              placeholder={geminiSet ? geminiMasked || "AIza…" : "AIza…"}
              defaultValue=""
            />
            {geminiSet ? (
              <p className="text-[9px] text-positive mt-1">
                {it
                  ? `Salvata sul server · ${geminiMasked || "✓"}`
                  : `Saved on server · ${geminiMasked || "✓"}`}
              </p>
            ) : (
              <p className="text-[9px] text-ink-muted/80 mt-1">
                {it ? "Non configurata (ok se Claude è attivo)." : "Not set (ok if Claude is active)."}
              </p>
            )}
          </label>

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
              disabled={busy || !(anthropicSet || geminiSet)}
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
