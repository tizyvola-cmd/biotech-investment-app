import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  sendCatalystCopilotChat,
  type AiProviderInfo,
  type ClinicalPreCdRecord,
  type CopilotChatMessage,
} from "../api/supernova";
import type { CopilotStudyFocus } from "./catalystCopilotFocus";
import {
  buildTickerCritSummaryPrefill,
  buildTickerKpiReviewPrefill,
} from "./catalystCopilotFocus";

const SUGGESTIONS_IT = [
  "Riassumi i report clinici visibili in tabella",
  "Quali studi hanno il miglior EIS e perché?",
  "Spiega gli indicatori ORR/DCR delle righe mostrate",
  "Confronta reazione prezzo T+1/T+3 tra i titoli in pagina",
] as const;

/** User-facing AI label (hide legacy «Copilot» naming). */
function displayAiProviderLabel(label: string): string {
  return label.replace(/\bCopilot\b/gi, "Intelligence");
}

function formatChatError(raw: string, it: boolean, cooldownS?: number): string {
  if (/abort|timed out|timeout/i.test(raw)) {
    return it
      ? "Richiesta interrotta o scaduta (90s). Spegni «PubMed + CT.gov», riprova, oppure Annulla e rilancia l’API."
      : "Request aborted or timed out (90s). Turn off live PubMed/CT.gov, retry, or restart the API.";
  }
  if (/too many requests|rate limit|429|limite richieste/i.test(raw)) {
    const wait =
      cooldownS != null && cooldownS > 0
        ? it
          ? ` Riprova tra ~${Math.ceil(cooldownS)}s.`
          : ` Retry in ~${Math.ceil(cooldownS)}s.`
        : it
          ? " Attendi 1–2 minuti."
          : " Wait 1–2 minutes.";
    return it
      ? `Limite GitHub Models (troppe richieste AI sul feed).${wait} Lascia «Ricerca live» spenta e un messaggio alla volta. Con ANTHROPIC_API_KEY o OPENAI_API_KEY in .env (e riavvio API) si usa un backup automatico.`
      : `GitHub Models rate limit.${wait} Keep live search off and one message at a time. Add ANTHROPIC_API_KEY or OPENAI_API_KEY in .env and restart the API for automatic fallback.`;
  }
  return raw;
}

const SUGGESTIONS_EN = [
  "Summarize clinical reports visible in the table",
  "Which studies have the best EIS and why?",
  "Explain ORR/DCR indicators on shown rows",
  "Compare T+1/T+3 price reaction across tickers on screen",
] as const;

type QuickAction = { id: string; label: string; prompt: string };

function buildQuickActions(scopeTicker: string | undefined, it: boolean): QuickAction[] {
  const tk = scopeTicker?.trim().toUpperCase();
  if (tk) {
    return [
      {
        id: "crit-summary",
        label: it ? `Summary ${tk}` : `${tk} summary`,
        prompt: buildTickerCritSummaryPrefill(tk, it),
      },
      {
        id: "kpi",
        label: it ? `KPI & prezzo ${tk}` : `${tk} KPI & price`,
        prompt: buildTickerKpiReviewPrefill(tk, it),
      },
      {
        id: "eis",
        label: it ? "Miglior EIS" : "Best EIS",
        prompt: it
          ? `Tra gli eventi ${tk} in tabella, quale ha il miglior EIS e perché?`
          : `Among ${tk} events in the table, which has the best EIS and why?`,
      },
    ];
  }
  const base = it ? [...SUGGESTIONS_IT] : [...SUGGESTIONS_EN];
  return base.map((prompt, i) => ({
    id: `gen-${i}`,
    label: prompt.length > 42 ? `${prompt.slice(0, 40)}…` : prompt,
    prompt,
  }));
}

export function CatalystCopilotChat({
  open,
  onClose,
  records,
  tickerHint,
  studyFocus,
  onStudyFocusConsumed,
  aiProvider,
  it,
}: {
  open: boolean;
  onClose: () => void;
  records: ClinicalPreCdRecord[];
  tickerHint: string;
  studyFocus?: CopilotStudyFocus | null;
  onStudyFocusConsumed?: () => void;
  aiProvider: AiProviderInfo | null;
  it: boolean;
}) {
  const [messages, setMessages] = useState<CopilotChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [liveResearch, setLiveResearch] = useState(false); // default off — avoids extra 429s
  const [lastSources, setLastSources] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoSentKeyRef = useRef<string | null>(null);

  const providerLabel = displayAiProviderLabel(
    aiProvider?.label ?? (it ? "Intelligence · AI" : "Intelligence · AI"),
  );
  const available = aiProvider?.available !== false;
  const githubCooldown = aiProvider?.github_cooldown_s ?? 0;
  const githubLimited = Boolean(aiProvider?.github_rate_limited) || githubCooldown > 0;

  const contextTickers = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      const t = String(r.ticker ?? "").trim().toUpperCase();
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [records]);

  const scopeTicker = tickerHint.trim().toUpperCase() || undefined;
  const chatTicker = scopeTicker ?? studyFocus?.ticker?.trim().toUpperCase();

  const pageRecordsForChat = useMemo(() => {
    const tk = chatTicker;
    const pool = tk
      ? records.filter((r) => (r.ticker ?? "").toUpperCase() === tk)
      : records;
    return pool.slice(0, 12);
  }, [records, chatTicker]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const cancelSend = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || sending) return;
      setError(null);
      const userMsg: CopilotChatMessage = { role: "user", content: msg };
      const priorMessages = messages;
      const nextHistory = [...priorMessages, userMsg];
      setMessages(nextHistory);
      setInput("");
      setSending(true);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const timeoutId = window.setTimeout(() => ac.abort(), 90_000);
      try {
        const res = await sendCatalystCopilotChat(
          {
            message: msg,
            history: priorMessages,
            ticker: chatTicker,
            tickers: chatTicker ? undefined : contextTickers.slice(0, 40),
            page_records: pageRecordsForChat,
            lang: it ? "it" : "en",
            use_live_research: liveResearch,
          },
          { signal: ac.signal },
        );
        if (!res.ok || !res.reply) {
          setMessages(priorMessages);
          setInput(msg);
          const errText = formatChatError(
            res.user_message ??
              res.hint ??
              res.error ??
              (it ? "Risposta AI non disponibile" : "AI reply unavailable"),
            it,
            res.github_cooldown_s,
          );
          setError(errText);
          return;
        }
        setLastSources(res.sources ?? []);
        setMessages([...nextHistory, { role: "assistant", content: res.reply }]);
      } catch (e) {
        if (ac.signal.aborted) {
          setMessages(priorMessages);
          setInput(msg);
          setError(
            formatChatError(
              it ? "Richiesta annullata" : "Request cancelled",
              it,
            ),
          );
          return;
        }
        setMessages(priorMessages);
        setInput(msg);
        setError(formatChatError(e instanceof Error ? e.message : String(e), it));
      } finally {
        window.clearTimeout(timeoutId);
        if (abortRef.current === ac) abortRef.current = null;
        setSending(false);
      }
    },
    [
      messages,
      sending,
      chatTicker,
      contextTickers,
      pageRecordsForChat,
      it,
      liveResearch,
    ],
  );

  useEffect(() => {
    if (!studyFocus?.prefill) return;
    const prefill = studyFocus.prefill;
    if (studyFocus.autoSend) {
      const key = `${studyFocus.ticker ?? ""}|${prefill.slice(0, 120)}`;
      if (autoSentKeyRef.current === key) return;
      autoSentKeyRef.current = key;
      onStudyFocusConsumed?.();
      void send(prefill);
      return;
    }
    setInput(prefill);
    onStudyFocusConsumed?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [studyFocus, onStudyFocusConsumed, send]);

  const quickActions = useMemo(
    () => buildQuickActions(scopeTicker, it),
    [scopeTicker, it],
  );

  const clearChat = () => {
    cancelSend();
    autoSentKeyRef.current = null;
    setMessages([]);
    setError(null);
    setLastSources([]);
  };

  if (!open) return null;

  return (
    <aside
      className="catalyst-copilot flex flex-col w-[min(100%,400px)] shrink-0 border-l border-violet-200/80 bg-[rgb(var(--surface-elevated))] shadow-xl z-10"
      aria-label={it ? "Chat Intelligence Catalyst Feed" : "Catalyst Feed Intelligence chat"}
    >
      <header className="shrink-0 px-3 py-2.5 border-b border-violet-200/60 bg-gradient-to-r from-violet-50 to-indigo-50/80">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-violet-950 flex items-center gap-1.5">
              <span aria-hidden>🧠</span>
              Intelligence
            </h3>
            <p className="text-[10px] text-violet-800/80 mt-0.5 leading-snug">
              {scopeTicker
                ? it
                  ? `Contesto: ${scopeTicker} · snapshot + web`
                  : `Context: ${scopeTicker} · snapshot + web`
                : it
                  ? `${contextTickers.length} ticker · snapshot + web`
                  : `${contextTickers.length} tickers · snapshot + web`}
              {" · "}
              <span className={available ? "text-emerald-700" : "text-amber-700"}>
                {providerLabel}
              </span>
            </p>
            <label
              className={`flex items-center gap-1.5 mt-1.5 text-[10px] cursor-pointer select-none ${
                githubLimited ? "text-amber-800" : "text-violet-900"
              }`}
              title={
                it
                  ? "Opzionale: query extra PubMed/CT.gov (più lenta, può saturare GitHub Models)"
                  : "Optional: extra PubMed/CT.gov queries (slower, may hit GitHub rate limits)"
              }
            >
              <input
                type="checkbox"
                checked={liveResearch}
                disabled={githubLimited}
                onChange={(e) => setLiveResearch(e.target.checked)}
                className="rounded accent-violet-600"
              />
              {it ? "Anche PubMed + CT.gov (web)" : "Also PubMed + CT.gov (web)"}
            </label>
            {githubLimited && (
              <p className="text-[9px] text-amber-800 mt-0.5 leading-snug">
                {it
                  ? `GitHub in pausa ~${Math.ceil(githubCooldown)}s — chat usa solo dati tabella.`
                  : `GitHub cooldown ~${Math.ceil(githubCooldown)}s — chat uses table data only.`}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost text-xs px-2 py-1 shrink-0"
            onClick={onClose}
            aria-label={it ? "Chiudi chat" : "Close chat"}
          >
            ✕
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {lastSources.length > 0 && (
          <p className="text-[9px] text-slate-500 px-0.5">
            {it ? "Fonti ultima risposta:" : "Last reply sources:"}{" "}
            {lastSources.join(" · ")}
          </p>
        )}
        {messages.length === 0 && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2.5 text-[11px] text-violet-900/90 leading-relaxed">
            {it
              ? "Approfondisci righe già in tabella (summary, KPI, EIS, T+1/T+3). «Ricerca live» è opzionale e spesso non serve."
              : "Deepen rows already in the table (summary, KPI, EIS, T+1/T+3). Live search is optional and often unnecessary."}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[92%] rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-violet-600 text-white rounded-br-sm"
                  : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 px-1">
            <p className="text-[11px] text-violet-600 animate-pulse">
              {liveResearch
                ? it
                  ? "Intelligence sta elaborando (può richiedere fino a ~90s con ricerca web)…"
                  : "Intelligence is working (up to ~90s with live web research)…"
                : it
                  ? "Intelligence sta elaborando…"
                  : "Intelligence is thinking…"}
            </p>
            <button
              type="button"
              className="text-[10px] font-semibold text-red-700 border border-red-200 bg-red-50 rounded px-2 py-0.5 hover:bg-red-100"
              onClick={cancelSend}
            >
              {it ? "Annulla" : "Cancel"}
            </button>
          </div>
        )}
        {error && (
          <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 px-3 pb-2 border-t border-violet-100/80 bg-violet-50/30">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-800/70 mb-1.5">
          {scopeTicker
            ? it
              ? `Azioni rapide · ${scopeTicker}`
              : `Quick actions · ${scopeTicker}`
            : it
              ? "Azioni rapide"
              : "Quick actions"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {quickActions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition disabled:opacity-40 ${
                a.id === "crit-summary"
                  ? "border-violet-400 bg-violet-600 text-white hover:bg-violet-700"
                  : "border-violet-200 bg-white text-violet-800 hover:bg-violet-50"
              }`}
              onClick={() => void send(a.prompt)}
              disabled={sending}
              title={a.prompt}
            >
              {a.label}
            </button>
          ))}
        </div>
        {scopeTicker ? (
          <p className="text-[9px] text-violet-800/65 mt-1.5 leading-snug">
            {it
              ? "Usa i dati delle righe filtrate in tabella (filtra «Ticker» = stesso simbolo)."
              : "Uses rows filtered in the table (Ticker filter = same symbol)."}
          </p>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-violet-100 p-2.5 space-y-1.5 bg-white/80">
        <div className="flex gap-1.5 items-end">
          <textarea
            ref={inputRef}
            rows={2}
            className="input flex-1 text-[12px] py-2 resize-none min-h-[2.75rem] max-h-32"
            placeholder={
              scopeTicker
                ? it
                  ? `Es. «Summary criticità e passi avanti su ${scopeTicker}»`
                  : `E.g. “${scopeTicker} — risks, progress, KPIs”`
                : it
                  ? "Es. «Cosa dice l’ultimo studio su IRWD?»"
                  : "E.g. “What does the latest IRWD study show?”"
            }
            value={input}
            disabled={sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button
            type="button"
            disabled={sending || !input.trim()}
            onClick={() => void send(input)}
            className="px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40 shrink-0"
            style={{ background: "#6d28d9" }}
          >
            {it ? "Invia" : "Send"}
          </button>
        </div>
        <div className="flex justify-between items-center">
          <button
            type="button"
            className="text-[10px] text-slate-500 hover:text-slate-700"
            onClick={clearChat}
            disabled={sending || messages.length === 0}
          >
            {it ? "Svuota chat" : "Clear chat"}
          </button>
          <span className="text-[9px] text-slate-400">Enter · Shift+Enter newline</span>
        </div>
      </footer>
    </aside>
  );
}
