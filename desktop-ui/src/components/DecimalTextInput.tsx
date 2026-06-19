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
      className={className}
      title={title}
      placeholder={placeholder}
      value={focused ? draft : value > 0 ? formatDecimalInput(value) : ""}
      onFocus={() => {
        setFocused(true);
        const initial = value > 0 ? formatDecimalInput(value) : "";
        setDraft(initial);
        draftRef.current = initial;
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
      }}
    />
  );
}
