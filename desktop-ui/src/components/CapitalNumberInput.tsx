import { useEffect, useRef, useState } from "react";
import { parseInputDecimal } from "../sheet/decimalInput";

type CapitalNumberInputProps = {
  value: number;
  /** Return false to reject the commit (e.g. insufficient cash) — draft stays visible. */
  onCommit: (n: number) => boolean | void;
  placeholder?: string;
  className?: string;
  step?: number;
  rejectTitle?: string;
};

/** Capital $ — text field (comma or dot); commits on blur/Enter. No spinners. */
export function CapitalNumberInput({
  value,
  onCommit,
  placeholder,
  className = "input w-24 py-0.5 text-xs tabular-nums",
  step: _step = 100,
  rejectTitle,
}: CapitalNumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const [rejected, setRejected] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!focused && !rejected) {
      setDraft(value > 0 ? String(Math.round(value)) : "");
    }
  }, [value, focused, rejected]);

  const commitDraft = () => {
    const raw = draftRef.current;
    if (raw.trim() === "" || raw.trim() === "-") {
      const ok = onCommit(0);
      if (ok === false) return null;
      return 0;
    }
    const n = parseInputDecimal(raw);
    const rounded = n >= 0 ? Math.round(n) : 0;
    const ok = onCommit(rounded);
    if (ok === false) return null;
    return rounded;
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={`relative z-[2] min-h-[28px] ${className}${rejected ? " ring-1 ring-red-500/70 bg-red-500/5" : ""}`}
      placeholder={placeholder}
      title={rejected ? rejectTitle : undefined}
      value={focused || rejected ? draft : value > 0 ? String(Math.round(value)) : ""}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        setFocused(true);
        setRejected(false);
        const initial = value > 0 ? String(Math.round(value)) : draft;
        setDraft(initial);
        draftRef.current = initial;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setRejected(false);
        setDraft(e.target.value);
        draftRef.current = e.target.value;
      }}
      onBlur={() => {
        const rounded = commitDraft();
        if (rounded === null) {
          setRejected(true);
          return;
        }
        setFocused(false);
        setRejected(false);
        setDraft(rounded > 0 ? String(rounded) : "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setRejected(false);
          setDraft(value > 0 ? String(Math.round(value)) : "");
          draftRef.current = value > 0 ? String(Math.round(value)) : "";
          setFocused(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
