import { useT } from "../shared/i18n";

export function ViewErrorFallback({
  label,
  message,
  chunkLoad,
  onRetry,
}: {
  label?: string;
  message: string;
  chunkLoad: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center flex-1 min-h-[200px]">
      <p className="text-sm font-semibold text-red-700">
        {label ? t("viewError.titleWithLabel", { label }) : t("viewError.title")}
      </p>
      <p className="text-[12px] text-slate-600 max-w-lg break-words">
        {chunkLoad ? t("viewError.chunkLoad") : message}
      </p>
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
