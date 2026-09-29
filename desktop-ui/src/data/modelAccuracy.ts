import { api } from "../api/supernova";
import { fetchProjectJson } from "./projectData";

export async function loadAccuracyV4V5Summary() {
  const { data } = await fetchProjectJson<{ summary?: unknown; error?: string }>(
    "accuracy_v4_v5_summary.json"
  );
  if (data?.summary) return { doc: data.summary as Record<string, unknown>, source: "locale" };
  try {
    const res = await api<{ summary?: unknown; error?: string }>(
      "/api/sheets/accuracy/v4-v5-summary"
    );
    if (res.summary) return { doc: res.summary as Record<string, unknown>, source: "API" };
    return { doc: null, source: "", error: res.error ?? "Summary assente" };
  } catch (e) {
    return {
      doc: null,
      source: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function loadModelAccuracyMonitor() {
  const { data } = await fetchProjectJson<{ entries?: unknown[]; error?: string }>(
    "model_accuracy_monitor_history.json"
  );
  if (data?.entries) return { doc: data, source: "locale" };
  try {
    const res = await api<{ entries?: unknown[]; error?: string }>(
      "/api/models/accuracy-monitor"
    );
    return { doc: res, source: "API" };
  } catch (e) {
    return {
      doc: { entries: [] },
      source: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
