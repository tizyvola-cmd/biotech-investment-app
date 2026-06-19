export type MobileLang = "en" | "it";

const LS_LANG = "sn_mobile_lang";

/** Default UI language — English is the source language for new copy. */
export function getMobileLang(): MobileLang {
  if (typeof window === "undefined") return "en";
  const v = localStorage.getItem(LS_LANG);
  return v === "it" ? "it" : "en";
}

export function setMobileLang(lang: MobileLang): void {
  localStorage.setItem(LS_LANG, lang);
}

export function localeForLang(lang: MobileLang): string {
  return lang === "it" ? "it-IT" : "en-US";
}
