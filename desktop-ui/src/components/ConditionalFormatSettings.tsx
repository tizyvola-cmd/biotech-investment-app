import { useMemo, useState } from "react";
import {
  COLOR_SCALE_LABELS,
  DATA_BAR_COLORS,
  DATA_BAR_LABELS,
  ICON_SET_LABELS,
  loadConditionalFormatPrefs,
  newRuleId,
  saveConditionalFormatPrefs,
  type CfRule,
  type ConditionalFormatPrefs,
  type ColorScalePreset,
  type DataBarPreset,
  type IconSetPreset,
} from "../sheet/conditionalFormat";

type DraftRule = CfRule | null;

export function ConditionalFormatSettings({
  sheetId,
  allColumns,
  onChange,
}: {
  sheetId: string;
  allColumns: string[];
  onChange?: (prefs: ConditionalFormatPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<ConditionalFormatPrefs>(() =>
    loadConditionalFormatPrefs(sheetId)
  );
  const [draft, setDraft] = useState<DraftRule>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const numericHints = useMemo(
    () => allColumns.filter((c) => !/^(ticker|symbol|nct|link|sponsor)/i.test(c.replace(/\n/g, " "))),
    [allColumns]
  );

  const persist = (next: ConditionalFormatPrefs) => {
    setPrefs(next);
    saveConditionalFormatPrefs(sheetId, next);
    onChange?.(next);
  };

  function startAdd(type: CfRule["type"]) {
    const base = {
      id: newRuleId(),
      enabled: true,
      column: numericHints[0] ?? "*",
      priority: prefs.rules.length,
    };
    if (type === "dataBar") {
      setDraft({ ...base, type: "dataBar", preset: "green", gradient: true });
    } else if (type === "iconSet") {
      setDraft({ ...base, type: "iconSet", preset: "arrows3", iconOnly: false });
    } else {
      setDraft({ ...base, type: "colorScale", preset: "diverging" });
    }
    setEditingId(null);
  }

  function startEdit(rule: CfRule) {
    setDraft({ ...rule });
    setEditingId(rule.id);
  }

  function saveDraft() {
    if (!draft) return;
    const rules = editingId
      ? prefs.rules.map((r) => (r.id === editingId ? draft : r))
      : [...prefs.rules, draft];
    persist({ ...prefs, rules });
    setDraft(null);
    setEditingId(null);
  }

  function removeRule(id: string) {
    persist({ ...prefs, rules: prefs.rules.filter((r) => r.id !== id) });
    if (editingId === id) {
      setDraft(null);
      setEditingId(null);
    }
  }

  function toggleRule(id: string) {
    persist({
      ...prefs,
      rules: prefs.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    });
  }

  function ruleSummary(r: CfRule): string {
    const col = r.column === "*" ? "tutte le colonne numeriche" : r.column.replace(/\n/g, " ");
    if (r.type === "colorScale") return `${COLOR_SCALE_LABELS[r.preset]} → ${col}`;
    if (r.type === "dataBar") return `Barra ${DATA_BAR_LABELS[r.preset]} → ${col}`;
    return `${ICON_SET_LABELS[r.preset]} → ${col}`;
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setOpen((v) => !v)}
        title="Scale colore, barre dati, set di icone"
      >
        Formattazione
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Chiudi formattazione"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-[min(26rem,94vw)] rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-elevated))] shadow-xl p-4 space-y-3 max-h-[min(78vh,36rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Formattazione condizionale</p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  {sheetId} — regole salvate su questo dispositivo (come Excel).
                </p>
              </div>
              <button type="button" className="btn-ghost text-xs px-2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.overrideBuiltInBackground}
                onChange={(e) =>
                  persist({ ...prefs, overrideBuiltInBackground: e.target.checked })
                }
              />
              Le regole utente sostituiscono gli sfondi automatici del foglio
            </label>

            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-0.5"
                onClick={() => startAdd("colorScale")}
              >
                + Scala colori
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-0.5"
                onClick={() => startAdd("dataBar")}
              >
                + Barra dati
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-0.5"
                onClick={() => startAdd("iconSet")}
              >
                + Icone
              </button>
            </div>

            {draft && (
              <div className="rounded-lg border border-accent/40 bg-surface/60 p-3 space-y-2 text-xs">
                <p className="font-medium text-accent">
                  {editingId ? "Modifica regola" : "Nuova regola"}
                </p>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Colonna</span>
                  <select
                    className="input text-xs py-1"
                    value={draft.column}
                    onChange={(e) => setDraft({ ...draft, column: e.target.value })}
                  >
                    <option value="*">* Tutte le colonne numeriche</option>
                    {allColumns.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/\n/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>

                {draft.type === "colorScale" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-muted">Scala colori</span>
                    <select
                      className="input text-xs py-1"
                      value={draft.preset}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          preset: e.target.value as ColorScalePreset,
                        })
                      }
                    >
                      {Object.entries(COLOR_SCALE_LABELS).map(([k, lab]) => (
                        <option key={k} value={k}>
                          {lab}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {draft.type === "dataBar" && (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">Colore barra</span>
                      <select
                        className="input text-xs py-1"
                        value={draft.preset}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            preset: e.target.value as DataBarPreset,
                          })
                        }
                      >
                        {Object.entries(DATA_BAR_LABELS).map(([k, lab]) => (
                          <option key={k} value={k}>
                            {lab}
                          </option>
                        ))}
                      </select>
                    </label>
                    {draft.preset === "custom" && (
                      <label className="flex flex-col gap-1">
                        <span className="text-ink-muted">Hex</span>
                        <input
                          className="input text-xs py-1"
                          type="color"
                          value={draft.barColor ?? "#70AD47"}
                          onChange={(e) =>
                            setDraft({ ...draft, barColor: e.target.value })
                          }
                        />
                      </label>
                    )}
                    {draft.preset !== "custom" && (
                      <div
                        className="h-3 rounded"
                        style={{
                          background: `linear-gradient(to right, ${DATA_BAR_COLORS[draft.preset as keyof typeof DATA_BAR_COLORS]} 0%, transparent 100%)`,
                        }}
                      />
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.gradient !== false}
                        onChange={(e) =>
                          setDraft({ ...draft, gradient: e.target.checked })
                        }
                      />
                      Gradiente semitrasparente
                    </label>
                  </>
                )}

                {draft.type === "iconSet" && (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">Set icone</span>
                      <select
                        className="input text-xs py-1"
                        value={draft.preset}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            preset: e.target.value as IconSetPreset,
                          })
                        }
                      >
                        {Object.entries(ICON_SET_LABELS).map(([k, lab]) => (
                          <option key={k} value={k}>
                            {lab}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.iconOnly ?? false}
                        onChange={(e) =>
                          setDraft({ ...draft, iconOnly: e.target.checked })
                        }
                      />
                      Solo icona (nascondi numero)
                    </label>
                  </>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Priorità (ordine applicazione)</span>
                  <input
                    className="input text-xs py-1 w-20"
                    type="number"
                    min={0}
                    max={99}
                    value={draft.priority}
                    onChange={(e) =>
                      setDraft({ ...draft, priority: Number(e.target.value) || 0 })
                    }
                  />
                </label>

                <div className="flex gap-2 pt-1">
                  <button type="button" className="btn-ghost text-xs" onClick={saveDraft}>
                    Salva regola
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setDraft(null);
                      setEditingId(null);
                    }}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-medium mb-1">
                Regole attive ({prefs.rules.filter((r) => r.enabled).length}/{prefs.rules.length})
              </p>
              {prefs.rules.length === 0 ? (
                <p className="text-[11px] text-ink-muted py-2">
                  Nessuna regola. Aggiungi scala colori, barra dati o icone.
                </p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto border border-[rgb(var(--border))]/60 rounded-lg p-1">
                  {prefs.rules.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-1 rounded-md hover:bg-surface/80 px-1 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={() => toggleRule(r.id)}
                      />
                      <span className="flex-1 text-[10px] leading-tight truncate" title={ruleSummary(r)}>
                        {ruleSummary(r)}
                      </span>
                      <button
                        type="button"
                        className="btn-ghost px-1 text-[10px]"
                        onClick={() => startEdit(r)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-1 text-[10px] text-negative"
                        onClick={() => removeRule(r.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-[rgb(var(--border))]/40 pt-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  persist({ ...prefs, rules: [] });
                  setDraft(null);
                }}
              >
                Elimina tutte
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  const simPresets: CfRule[] = [];
                  if (allColumns.includes("Var. Giorn. %")) {
                    simPresets.push({
                      id: newRuleId(),
                      enabled: true,
                      column: "Var. Giorn. %",
                      priority: 0,
                      type: "colorScale",
                      preset: "diverging",
                    });
                  }
                  if (allColumns.includes("Market Cap")) {
                    simPresets.push({
                      id: newRuleId(),
                      enabled: true,
                      column: "Market Cap",
                      priority: 1,
                      type: "dataBar",
                      preset: "green",
                      gradient: true,
                    });
                  }
                  persist({ ...prefs, rules: [...prefs.rules, ...simPresets] });
                }}
              >
                Preset Simulation
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
