import { useMemo } from "react";
import type { SheetTable } from "../types";
import { clinicalSheetCellRenderer } from "../sheet/clinicalCellRender";
import {
  buildSimulationCdCatalog,
  CLINICAL_MAX_CD_DAYS,
  filterClinicalForSimulationCd,
  type SimCdCatalyst,
} from "../sheet/clinicalSimulationFilter";
import { SimulationPortfolioSheetView } from "./SimulationPortfolioSheetView";

export function ClinicalSimulationView({
  simTable,
  clinicalTable,
  loading,
  error,
  onReload,
}: {
  simTable: SheetTable | null;
  clinicalTable: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const catalog = useMemo(() => buildSimulationCdCatalog(simTable), [simTable]);

  const cdTable = useMemo(
    () => filterClinicalForSimulationCd(clinicalTable, catalog),
    [clinicalTable, catalog]
  );

  const simCdByTicker = useMemo(() => {
    const o: Record<string, SimCdCatalyst> = {};
    for (const [k, v] of catalog) o[k] = v;
    return o;
  }, [catalog]);

  const missingCd = useMemo(() => {
    const simTickers = new Set(catalog.keys());
    const withStudy = new Set(
      (cdTable?.rows ?? []).map((r) =>
        String(r.ticker ?? r.Ticker ?? "")
          .trim()
          .toUpperCase()
      )
    );
    return [...simTickers].filter((t) => !withStudy.has(t));
  }, [catalog, cdTable?.rows]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3">
      <SimulationPortfolioSheetView
        title="Clinical — studio catalyst Simulation"
        sourceHint={
          <>
            solo ticker Simulation con CD entro{" "}
            <strong className="text-ink">{CLINICAL_MAX_CD_DAYS} giorni</strong>
            {" "}e studio OpenFDA con la stessa{" "}
            <strong className="text-ink">Completion Date</strong> (o NCT) ·{" "}
            <code className="text-accent">biotech_clinical_openfda</code>
          </>
        }
        countLabel="studi catalyst"
        simTable={simTable}
        dataTable={cdTable}
        loading={loading}
        error={error}
        onReload={onReload}
        layoutSheetId="Clinical_OpenFDA"
        renderCell={clinicalSheetCellRenderer}
        simCdByTicker={simCdByTicker}
        emptyTickerHint="Nessuno studio clinical con CD/NCT coincidente"
      />
      {missingCd.length > 0 && !loading && (
        <p className="text-xs text-ink-muted px-1">
          Senza match clinical: {missingCd.join(", ")} — verifica NCT/CD nel foglio
          Simulation o aggiorna il file OpenFDA.
        </p>
      )}
    </div>
  );
}
