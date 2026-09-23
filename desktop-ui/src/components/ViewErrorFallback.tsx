import { useT } from "../shared/i18n";

function isElectronShell(): boolean {
  if (typeof window === "undefined") return false;
  const sn = (window as Window & { supernova?: { projectDataBase?: string } }).supernova;
  return Boolean(sn?.projectDataBase);
}

export function ViewErrorFallback({
  label,
  message,
  chunkLoad,
  showTechnicalDetail = false,
  onRetry,
}: {
  label?: string;
  message: string;
  chunkLoad: boolean;
  /** Admin/owner only — testers must not see raw exception text. */
  showTechnicalDetail?: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  let body: string;
  if (chunkLoad) {
    body = t(isElectronShell() ? "viewError.chunkLoad" : "viewError.chunkLoadWeb");
  } else if (showTechnicalDetail) {
    body = message;
  } else {
    body = t("viewError.userSoft");
  }
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center flex-1 min-h-[200px]">
      <p className="text-sm font-semibold text-red-700">
        {showTechnicalDetail && label
          ? t("viewError.titleWithLabel", { label })
          : t("viewError.title")}
      </p>
      <p className="text-[12px] text-slate-600 max-w-lg break-words">{body}</p>
      <button
        type="button"
        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-slate-800 text-white"
        onClick={onRetry}
      >
        {t("viewError.retry")}
      </button>
    </div>
  );
}
