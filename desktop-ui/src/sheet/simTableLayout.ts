export type SimTableLayoutId = "full" | "variations";

const STORAGE_KEY = "supernova_sim_table_layout";

export function loadSimTableLayout(): SimTableLayoutId {
  if (typeof window === "undefined") return "full";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "variations" || raw === "full") return raw;
  } catch {
    /* private mode */
  }
  return "full";
}

export function saveSimTableLayout(layout: SimTableLayoutId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, layout);
}
