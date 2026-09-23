import { createPortal } from "react-dom";
import { useMobileLang } from "../hooks/useMobileLang";

type Props = {
  open: boolean;
  onClose: () => void;
};

const INDEX_IDS = ["rec", "sds", "eis", "loss", "regulatory", "mcs"] as const;

export function MobileDecisionIndicesGuideSheet({ open, onClose }: Props) {
  const { t } = useMobileLang();
  if (!open) return null;

  return createPortal(
    <div className="sheet-root decision-guide-sheet-root" role="dialog" aria-modal="true" aria-label={t("decision.guideTitle")}>
      <button type="button" className="sheet-backdrop" aria-label={t("common.close")} onClick={onClose} />
      <div className="sheet-panel decision-guide-panel">
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div>
            <h2>{t("decision.guideTitle")}</h2>
            <p className="decision-guide-subtitle">{t("decision.guideSubtitle")}</p>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="sheet-body decision-guide-body">
          <p className="hint decision-guide-inv">{t("decision.guideInvNote")}</p>
          <ul className="decision-guide-list">
            {INDEX_IDS.map((id) => (
              <li key={id} className="decision-guide-item">
                <div className="decision-guide-item-head">
                  <strong>{t(`decision.index.${id}.acronym`)}</strong>
                  <span className="decision-guide-full">{t(`decision.index.${id}.full`)}</span>
                </div>
                <p className="hint decision-guide-desc">{t(`decision.index.${id}.desc`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
