import type { CatalystRow, PastPredDocument } from "../types";
import { api, probeApiReachable } from "../api/supernova";
import {
  isValidCatalystTicker,
  normalizeCatalystTicker,
} from "../components/catalystUiHelpers";
import { desktopDataDirHint, fetchProjectJson, projectDataUrl } from "./projectData";

const JSON_FILES = ["ui_snapshot.json", "past_catalyst_predictions.json"] as const;

function rowsFromDoc(
  doc: PastPredDocument & { catalysts?: CatalystRow[] },
  source: string
): { rows: CatalystRow[]; source: string } | null {
  if (Array.isArray(doc.catalysts) && doc.catalysts.length > 0) {
    return { rows: sanitizeCatalystRows(doc.catalysts), source };
  }
  const rows = mapPastPredDoc(doc);
  if (rows.length > 0) return { rows, source };
  return null;
}

export async function loadPredictions(): Promise<{
  rows: CatalystRow[];
  source: string;
  error?: string;
}> {
  let lastErr = "";
  for (const file of JSON_FILES) {
    const { data: doc, detail, status } = await fetchProjectJson<
      PastPredDocument & { catalysts?: CatalystRow[] }
    >(file);
    if (doc) {
      const mapped = rowsFromDoc(doc, projectDataUrl(file));
      if (mapped) return mapped;
      lastErr = `${file}: JSON vuoto`;
      continue;
    }
    lastErr = detail || `${file}: HTTP ${status ?? "?"}`;
  }

  if (await probeApiReachable()) {
    try {
      const doc = await api<PastPredDocument & { catalysts?: CatalystRow[] }>(
        "/api/predictions",
        undefined,
        { timeoutMs: 12_000 },
      );
      const mapped = rowsFromDoc(doc, "/api/predictions");
      if (mapped) return mapped;
      lastErr = "API /api/predictions: nessuna riga";
    } catch (e) {
      const apiErr = e instanceof Error ? e.message : String(e);
      if (!lastErr) lastErr = apiErr;
      else lastErr = `${lastErr}; API: ${apiErr}`;
    }
  } else if (!lastErr) {
    lastErr = "API offline";
  }

  const apiStale =
    lastErr.includes("Not Found") && lastErr.includes("API");
  return {
    rows: [],
    source: "",
    error:
      `${lastErr || "Nessun file dati trovato"}. ` +
      `Cartella: ${desktopDataDirHint()}.` +
      (apiStale
        ? " Chiudi SperNova e termina eventuali python.exe sulla porta 8765, poi riapri l'app."
        : " Esegui scripts\\Export_Desktop_Snapshots.bat se i file mancano."),
  };
}

function sanitizeCatalystRows(rows: CatalystRow[]): CatalystRow[] {
  return rows
    .map((r) => ({
      ...r,
      ticker: normalizeCatalystTicker(r.id, r.ticker),
    }))
    .filter((r) => isValidCatalystTicker(r.ticker));
}

function mapPastPredDoc(doc: PastPredDocument): CatalystRow[] {
  const rawRows = doc.rows ?? {};
  const out: CatalystRow[] = [];
  for (const [id, rec] of Object.entries(rawRows)) {
    if (!rec || typeof rec !== "object") continue;
    const ticker = normalizeCatalystTicker(id, rec.ticker);
    if (!isValidCatalystTicker(ticker)) continue;
    const completionDate = String(rec.completion_date ?? "");
    const direction = String(rec.direction ?? rec.dir_v1 ?? "—");
    const dq =
      typeof rec.data_quality_score === "number"
        ? rec.data_quality_score
        : typeof rec.data_quality === "object" &&
            rec.data_quality !== null &&
            typeof (rec.data_quality as { quality_score?: unknown }).quality_score ===
              "number"
          ? (rec.data_quality as { quality_score: number }).quality_score
          : null;
    const affid =
      typeof rec.affidabilita === "number" ? rec.affidabilita : null;
    const confidence =
      dq !== null ? dq : affid !== null ? Math.min(1, Math.max(0, affid / 5)) : null;

    out.push({
      id,
      ticker,
      completionDate,
      direction,
      confidence,
      dataQualityScore: dq,
      stars: String(rec.stars ?? ""),
      phase: String(rec.phase ?? ""),
      sponsorMatch: String(rec.sponsor_match ?? ""),
      datiScarsi: Boolean(rec.dati_scarsi),
      predIncomplete: Boolean(rec.pred_dataset_incomplete),
      runUp30d: typeof rec.run_up_30d === "number" ? rec.run_up_30d : null,
      modelD7Pct: typeof rec.model_d7_pct === "number" ? rec.model_d7_pct : null,
      v5Q05Pct: typeof rec.v5_q05_pct === "number" ? rec.v5_q05_pct : null,
      v5Q95Pct: typeof rec.v5_q95_pct === "number" ? rec.v5_q95_pct : null,
      raw: rec,
    });
  }
  out.sort((a, b) => b.completionDate.localeCompare(a.completionDate));
  return out;
}

/** Curve modello % da campi ``model_d*`` / ``model_dm*`` nel JSON riga. */
export function modelCurvePoints(rec: Record<string, unknown>): { offset: number; pct: number }[] {
  const points: { offset: number; pct: number }[] = [];
  const add = (key: string, offset: number) => {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) points.push({ offset, pct: v });
  };
  add("model_dm60_pct", -60);
  add("model_dm30_pct", -30);
  add("model_dm10_pct", -10);
  add("model_dm7_pct", -7);
  add("model_dm5_pct", -5);
  add("model_dm3_pct", -3);
  add("model_d1_pct", 1);
  add("model_d3_pct", 3);
  add("model_d4_pct", 4);
  add("model_d5_pct", 5);
  add("model_d7_pct", 7);
  add("model_d10_pct", 10);
  add("model_d30_pct", 30);
  points.sort((a, b) => a.offset - b.offset);
  return points;
}
