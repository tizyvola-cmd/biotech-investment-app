import { useRef } from "react";
import { AppModal } from "./AppModal";
import { DashboardRecommendationsTable } from "./DashboardRecommendationsTable";
import type { ComponentProps } from "react";

type TableProps = ComponentProps<typeof DashboardRecommendationsTable>;

type Props = Omit<TableProps, "variant" | "onClose" | "onBindClose"> & {
  open: boolean;
  onClose: () => void;
};

export function DashboardRecommendationsModal({ open, onClose, ...tableProps }: Props) {
  const closeWithAckRef = useRef<() => void>(() => onClose());

  return (
    <AppModal
      open={open}
      onClose={() => closeWithAckRef.current()}
      aria-labelledby="dashboard-rec-modal-title"
      panelClassName="max-w-[min(96vw,1200px)] w-full flex flex-col overflow-hidden rounded-xl border border-[rgb(var(--border))]/50 bg-surface shadow-2xl"
    >
      <DashboardRecommendationsTable
        variant="modal"
        onClose={onClose}
        onBindClose={(fn) => {
          closeWithAckRef.current = fn;
        }}
        {...tableProps}
      />
    </AppModal>
  );
}
