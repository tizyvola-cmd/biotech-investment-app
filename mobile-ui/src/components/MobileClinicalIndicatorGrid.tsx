import type { ClinicalStudyIndicator } from "../api";
import {
  CLINICAL_KPI_TYPE_LABEL,
  clinicalKpiBadgeClass,
  directionColor,
  directionGlyph,
  indicatorIsContextOnly,
  prepareClinicalIndicators,
} from "../eis/clinicalIndicators";

type Props = {
  indicators?: ClinicalStudyIndicator[] | null;
  it?: boolean;
  maxShown?: number;
  note?: string;
  title?: string;
};

export function MobileClinicalIndicatorGrid({
  indicators,
  it = false,
  maxShown = 6,
  note,
  title,
}: Props) {
  const valid = prepareClinicalIndicators(indicators ?? []);
  if (!valid.length && !title) {
    return (
      <span className="hint">
        {it ? "Nessun KPI clinico quantificabile" : "No quantifiable clinical KPIs"}
      </span>
    );
  }

  const shown = valid.slice(0, maxShown);
  const extra = valid.length - shown.length;

  return (
    <div className="eis-clinical-block">
      {title ? <p className="eis-clinical-block-title">{title}</p> : null}
      {valid.length ? (
        <div className="eis-clinical-grid">
          {shown.map((ind, i) => {
            const contextOnly = indicatorIsContextOnly(ind);
            const glyph = directionGlyph(ind.direction);
            const kpiTag = ind.kpi_type ? CLINICAL_KPI_TYPE_LABEL[ind.kpi_type] ?? "" : "";
            const rawLabel = (ind.label ?? "").trim();
            const labelShort = rawLabel.length > 48 ? `${rawLabel.slice(0, 47)}…` : rawLabel;
            return (
              <div
                key={`${ind.label}-${ind.value}-${i}`}
                className={`eis-clinical-card${contextOnly ? " eis-clinical-card-ctx" : ""}`}
              >
                <div className="eis-clinical-card-head">
                  <span className="eis-clinical-label">
                    {labelShort || (it ? "Indicatore clinico" : "Clinical indicator")}
                  </span>
                  {contextOnly ? (
                    <span className="eis-kpi-badge eis-kpi-ctx">CTX</span>
                  ) : kpiTag ? (
                    <span className={clinicalKpiBadgeClass(ind.kpi_type)}>{kpiTag}</span>
                  ) : null}
                </div>
                <div className="eis-clinical-value-row">
                  <span className="eis-clinical-value">{ind.value}</span>
                  {glyph ? (
                    <span className="eis-clinical-glyph" style={{ color: directionColor(ind.direction) }}>
                      {glyph}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <span className="hint">
          {it ? "Nessun KPI clinico quantificabile" : "No quantifiable clinical KPIs"}
        </span>
      )}
      {extra > 0 ? (
        <p className="eis-clinical-more">
          +{extra} {it ? "altri indicatori" : "more indicators"}
        </p>
      ) : null}
      {note ? <p className="eis-clinical-note">{note}</p> : null}
    </div>
  );
}
