/**
 * Per-ticker free-text notes for EIS deep dive (competition / analyst notes).
 * localStorage — not Soft BUY/SELL.
 */
export type EisDeepDiveNote = {
  ticker: string;
  /** Competition landscape / SoC / peers free text. */
  competitionText: string;
  /** Optional catch-all note. */
  otherText: string;
  updatedAt: string;
};

const STORAGE_KEY = "supernova.eisDeepDiveNotes.v1";
const CHANGE_EVENT = "supernova-eis-deep-dive-notes";

type Store = Record<string, EisDeepDiveNote>;

const mem: { store: Store | null } = { store: null };

function safeGetItem(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    /* ignore */
  }
}

function loadStore(): Store {
  if (mem.store) return mem.store;
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) {
    mem.store = {};
    return mem.store;
  }
  try {
    const parsed = JSON.parse(raw) as Store;
    mem.store = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    mem.store = {};
  }
  return mem.store;
}

function persist(store: Store): void {
  mem.store = store;
  safeSetItem(STORAGE_KEY, JSON.stringify(store));
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

function emptyNote(ticker: string): EisDeepDiveNote {
  return {
    ticker,
    competitionText: "",
    otherText: "",
    updatedAt: new Date().toISOString(),
  };
}

export function getEisDeepDiveNote(ticker: string): EisDeepDiveNote {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return emptyNote("");
  return loadStore()[tk] ?? emptyNote(tk);
}

export function setEisDeepDiveCompetitionText(ticker: string, text: string): EisDeepDiveNote {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return emptyNote("");
  const store = { ...loadStore() };
  const prev = store[tk] ?? emptyNote(tk);
  if (prev.competitionText === text) return prev;
  const next: EisDeepDiveNote = {
    ...prev,
    ticker: tk,
    competitionText: text,
    updatedAt: new Date().toISOString(),
  };
  if (!next.competitionText.trim() && !next.otherText.trim()) {
    delete store[tk];
  } else {
    store[tk] = next;
  }
  persist(store);
  return next;
}

export function setEisDeepDiveOtherText(ticker: string, text: string): EisDeepDiveNote {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return emptyNote("");
  const store = { ...loadStore() };
  const prev = store[tk] ?? emptyNote(tk);
  if (prev.otherText === text) return prev;
  const next: EisDeepDiveNote = {
    ...prev,
    ticker: tk,
    otherText: text,
    updatedAt: new Date().toISOString(),
  };
  if (!next.competitionText.trim() && !next.otherText.trim()) {
    delete store[tk];
  } else {
    store[tk] = next;
  }
  persist(store);
  return next;
}

export function subscribeEisDeepDiveNotes(cb: () => void): () => void {
  const handler = () => cb();
  try {
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
  } catch {
    /* ignore */
  }
  return () => {
    try {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    } catch {
      /* ignore */
    }
  };
}

/** Test helper */
export function __resetEisDeepDiveNotesForTests(): void {
  mem.store = {};
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
