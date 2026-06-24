import { useEffect, useRef, useState } from "react";

type CapitalNumberInputProps = {
  value: number;
  onCommit: (n: number) => void;
  placeholder?: string;
  className?: string;
  step?: number;
};

/** Capital € with spinners; commits on blur/Enter only (avoids heavy persist on each keystroke). */
export function CapitalNumberInput({
  value,
  onCommit,
  placeholder,
  className = "input w-24 py-0.5 text-xs tabular-nums",
  step = 100,
}: CapitalNumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!focused) {
      setDraft(value > 0 ? String(Math.round(value)) : "");
    }
  }, [value, focused]);

  const commitDraft = () => {
    const raw = draftRef.current;
    if (raw === "" || raw === "-") {
      onCommit(0);
      return 0;
    }
    const n = Number(raw);
    const rounded = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    onCommit(rounded);
    return rounded;
  };

  return (
    <input
      type="number"
      min={0}
      step={step}
      className={className}
      placeholder={placeholder}
      value={focused ? draft : value > 0 ? value : ""}
      onFocus={() => {
        setFocused(true);
        const initial = value > 0 ? String(Math.round(value)) : "";
        setDraft(initial);
        draftRef.current = initial;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        draftRef.current = e.target.value;
      }}
      onBlur={() => {
        const rounded = commitDraft();
        setFocused(false);
        setDraft(rounded > 0 ? String(rounded) : "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
