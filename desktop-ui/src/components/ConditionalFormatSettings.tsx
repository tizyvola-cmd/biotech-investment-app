import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !btnRef.current || !panelRef.current) return;
    const btn = btnRef.current.getBoundingClientRect();
    const panelW = Math.min(416, window.innerWidth * 0.94);
    const vw = window.innerWidth;
    let left = btn.left;
    if (left + panelW > vw - 8) left = Math.max(8, vw - panelW - 8);
    const style: CSSProperties = { position: "fixed", top: btn.bottom + 4, left, width: panelW, zIndex: 50 };
    Object.assign(panelRef.current.style, style);
  }, [open]);

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
    const col = r.column === "*" ? "all numeric columns" : r.column.replace(/\n/g, " ");
    if (r.type === "colorScale") return `${COLOR_SCALE_LABELS[r.preset]} → ${col}`;
    if (r.type === "dataBar") return `Bar ${DATA_BAR_LABELS[r.preset]} → ${col}`;
    return `${ICON_SET_LABELS[r.preset]} → ${col}`;
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setOpen((v) => !v)}
        title="Color scales, data bars, icon sets"
      >
        Formatting
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close formatting"
            onClick={() => setOpen(false)}
          />
          <div ref={panelRef} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-elevated))] shadow-xl p-4 space-y-3 max-h-[min(78vh,36rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Conditional formatting</p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  {sheetId} — rules saved on this device (like Excel).
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
              User rules override the sheet's automatic backgrounds
            </label>

            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-0.5"
                onClick={() => startAdd("colorScale")}
              >
                + Color scale
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-0.5"
                onClick={() => startAdd("dataBar")}
              >
                + Data bar
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-0.5"
                onClick={() => startAdd("iconSet")}
              >
                + Icons
              </button>
            </div>

            {draft && (
              <div className="rounded-lg border border-accent/40 bg-surface/60 p-3 space-y-2 text-xs">
                <p className="font-medium text-accent">
                  {editingId ? "Edit rule" : "New rule"}
                </p>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Column</span>
                  <select
                    className="input text-xs py-1"
                    value={draft.column}
                    onChange={(e) => setDraft({ ...draft, column: e.target.value })}
                  >
                    <option value="*">* All numeric columns</option>
                    {allColumns.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/\n/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>

                {draft.type === "colorScale" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-muted">Color scale</span>
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
                      <span className="text-ink-muted">Bar color</span>
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
                      Semi-transparent gradient
                    </label>
                  </>
                )}

                {draft.type === "iconSet" && (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-ink-muted">Icon set</span>
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
                      Icon only (hide number)
                    </label>
                  </>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">Priority (application order)</span>
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
                    Save rule
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setDraft(null);
                      setEditingId(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-medium mb-1">
                Active rules ({prefs.rules.filter((r) => r.enabled).length}/{prefs.rules.length})
              </p>
              {prefs.rules.length === 0 ? (
                <p className="text-[11px] text-ink-muted py-2">
                  No rules. Add a color scale, data bar or icons.
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
                Delete all
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
