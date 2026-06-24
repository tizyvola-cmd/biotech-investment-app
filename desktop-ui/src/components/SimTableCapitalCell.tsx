import { CapitalNumberInput } from "./CapitalNumberInput";

type Props = {
  capital: number;
  placeholder?: string;
  inputClassName: string;
  wrapperClassName?: string;
  onCommit: (value: number) => void;
};

export function SimTableCapitalCell({
  capital,
  placeholder,
  inputClassName,
  wrapperClassName = "flex flex-col gap-0.5 min-w-0 items-center w-full",
  onCommit,
}: Props) {
  return (
    <div className={wrapperClassName}>
      <CapitalNumberInput
        className={inputClassName}
        value={capital > 0 ? capital : 0}
        placeholder={placeholder}
        onCommit={onCommit}
      />
    </div>
  );
}
