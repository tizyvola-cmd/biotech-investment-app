import { useEffect, useRef, useState } from "react";
import { formatDecimalInput, parseInputDecimal } from "../sheet/decimalInput";

type DecimalTextInputProps = {
  value: number;
  onCommit: (n: number) => void;
  placeholder?: string;
  className?: string;
  title?: string;
};

/** Text field for prices — no spinners; accepts comma or dot; commits on blur. */
export function DecimalTextInput({
  value,
  onCommit,
  placeholder,
  className = "input w-24 py-0.5 text-xs",
  title,
}: DecimalTextInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!focused) {
      setDraft(value > 0 ? formatDecimalInput(value) : "");
    }
  }, [value, focused]);

  const commitDraft = () => {
    const parsed = parseInputDecimal(draftRef.current);
    onCommit(parsed);
    return parsed;
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={`relative z-[2] min-h-[28px] ${className}`}
      title={title}
      placeholder={placeholder}
      value={focused ? draft : value > 0 ? formatDecimalInput(value) : ""}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        setFocused(true);
        const initial = value > 0 ? formatDecimalInput(value) : "";
        setDraft(initial);
        draftRef.current = initial;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        draftRef.current = e.target.value;
      }}
      onBlur={() => {
        const parsed = commitDraft();
        setFocused(false);
        setDraft(parsed > 0 ? formatDecimalInput(parsed) : "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          const revert = value > 0 ? formatDecimalInput(value) : "";
          setDraft(revert);
          draftRef.current = revert;
          setFocused(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
