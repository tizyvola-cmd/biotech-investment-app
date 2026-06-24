import type { SheetTable } from "../types";
import { desktopDataDirHint, fetchProjectJson } from "./projectData";

const SNAPSHOT_FILES = {
  simulation: "simulation_sheet_snapshot.json",
  clinical: "clinical_simulation_snapshot.json",
  secK8: "sec_k8_simulation_snapshot.json",
  accuracy: "accuracy_sheet_snapshot.json",
  financial: "financial_sheet_snapshot.json",
} as const;

export type LocalSheetKind = keyof typeof SNAPSHOT_FILES;

function normalizeSheetTable(
  snap: SheetTable | null,
  sheet: string
): SheetTable | null {
  if (!snap || !Array.isArray(snap.rows) || snap.rows.length === 0) return null;
  return {
    ...snap,
    row_count: snap.row_count ?? snap.rows.length,
    sheet: snap.sheet ?? sheet,
  };
}

export async function loadLocalSheet(kind: LocalSheetKind): Promise<SheetTable> {
  const file = SNAPSHOT_FILES[kind];
  const sheet =
    kind === "simulation"
      ? "Simulation"
      : kind === "clinical"
        ? "Clinical_OpenFDA"
        : kind === "secK8"
          ? "SEC 8-K"
          : kind === "accuracy"
          ? "Accuracy"
          : "Financial";
  const { data: snap, status, detail } = await fetchProjectJson<SheetTable>(file);
  const table = normalizeSheetTable(snap, sheet);
  if (table) return table;
  const hint = detail || (status === 404 ? "file missing" : "read failed");
  throw new Error(
    `${sheet} data not available (data/${file}: ${hint}). ` +
      `Folder: ${desktopDataDirHint()}. ` +
      `Close Excel, run Export_Desktop_Snapshots.bat or the Refresh tab, then Reload.`
  );
}
