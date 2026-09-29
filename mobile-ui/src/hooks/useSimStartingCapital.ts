import { useCallback, useState } from "react";
import {
  DEFAULT_SIM_STARTING_CAPITAL_EUR,
  loadSimStartingCapital,
  normalizeSimStartingCapital,
  saveSimStartingCapital,
} from "../mobileSimCapitalPrefs";

export function useSimStartingCapital() {
  const [startingCapital, setStartingCapitalState] = useState(() => loadSimStartingCapital());

  const setStartingCapital = useCallback((value: number) => {
    const next = normalizeSimStartingCapital(value);
    setStartingCapitalState(next);
    saveSimStartingCapital(next);
  }, []);

  return {
    startingCapital: startingCapital > 0 ? startingCapital : DEFAULT_SIM_STARTING_CAPITAL_EUR,
    setStartingCapital,
  };
}
