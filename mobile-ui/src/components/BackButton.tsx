import { useMobileLang } from "../hooks/useMobileLang";

export function BackButton({
  label,
  variant = "top",
  onClick,
}: {
  label?: string;
  variant?: "top" | "bottom";
  onClick: () => void;
}) {
  const { t } = useMobileLang();
  const text = label ?? t("common.back");
  return (
    <button type="button" className={variant === "bottom" ? "back-btn bottom" : "back-btn"} onClick={onClick}>
      ← {text}
    </button>
  );
}
