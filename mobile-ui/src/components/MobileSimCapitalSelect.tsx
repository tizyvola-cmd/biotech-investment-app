import { useMemo } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import { mobileSimCash } from "../mobilePortfolioCash";
import {
  formatSimCapitalPreset,
  SIM_STARTING_CAPITAL_PRESETS,
} from "../mobileSimCapitalPrefs";
import { fmtEur } from "../simLogic";
import type { InvestSimInputs, SheetTable } from "../types";

type Props = {
  value: number;
  onChange: (value: number) => void;
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
};

export function MobileSimCapitalSelect({ value, onChange, sheet, inputs }: Props) {
  const { t } = useMobileLang();
  const cash = useMemo(() => mobileSimCash(inputs, sheet, value), [inputs, sheet, value]);

  return (
    <label className="sim-capital-select" title={t("simCapital.hint")}>
      <span className="sim-capital-select-label">{t("simCapital.short")}</span>
      <select
        className="sim-capital-select-input"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t("simCapital.aria")}
      >
        {SIM_STARTING_CAPITAL_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {formatSimCapitalPreset(preset)}
          </option>
        ))}
      </select>
      <span className="sim-capital-select-avail" title={t("simCapital.availableHint")}>
        {fmtEur(cash.available, 0)}
      </span>
    </label>
  );
}
