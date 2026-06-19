import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { t as translate, type I18nKey } from "../i18n";
import { getMobileLang, localeForLang, setMobileLang, type MobileLang } from "../langStorage";

type MobileLangContextValue = {
  lang: MobileLang;
  setLang: (lang: MobileLang) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
  locale: string;
};

const MobileLangContext = createContext<MobileLangContextValue | null>(null);

export function MobileLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<MobileLang>(() => getMobileLang());

  const setLang = useCallback((next: MobileLang) => {
    setMobileLang(next);
    setLangState(next);
  }, []);

  const value = useMemo<MobileLangContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(key, lang, vars),
      locale: localeForLang(lang),
    }),
    [lang, setLang],
  );

  return <MobileLangContext.Provider value={value}>{children}</MobileLangContext.Provider>;
}

export function useMobileLang(): MobileLangContextValue {
  const ctx = useContext(MobileLangContext);
  if (!ctx) throw new Error("useMobileLang must be used within MobileLangProvider");
  return ctx;
}
