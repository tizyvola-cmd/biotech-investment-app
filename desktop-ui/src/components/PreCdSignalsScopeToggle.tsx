import type { PreCdSignalsScope } from "../sheet/preCdSignalsScope";
import { preCdScopeWindowLabel } from "../sheet/preCdSignalsScope";
import { useLang, useT } from "../shared/i18n";

export function PreCdSignalsScopeToggle({
  scope,
  onScopeChange,
  runupCount,
  nearCount,
}: {
  scope: PreCdSignalsScope;
  onScopeChange: (scope: PreCdSignalsScope) => void;
  runupCount: number;
  nearCount: number;
}) {
  const t = useT();
  const { lang } = useLang();

  const btn = (active: boolean) =>
    active
      ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/10 text-accent font-semibold"
      : "border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink hover:border-[rgb(var(--border))]/70";

  return (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <button
        type="button"
        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${btn(scope === "preCdRunup")}`}
        onClick={() => onScopeChange("preCdRunup")}
      >
        {t("preCd.scope.runup")}
        <span className="ml-1.5 tabular-nums opacity-80">({runupCount})</span>
      </button>
      <button
        type="button"
        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${btn(scope === "nearCd")}`}
        onClick={() => onScopeChange("nearCd")}
      >
        {t("preCd.scope.nearCd")}
        <span className="ml-1.5 tabular-nums opacity-80">({nearCount})</span>
      </button>
      <span className="text-[10px] text-ink-muted ml-auto">
        {t("preCd.scope.activeWindow")}: {preCdScopeWindowLabel(scope, lang)}
      </span>
    </div>
  );
}
