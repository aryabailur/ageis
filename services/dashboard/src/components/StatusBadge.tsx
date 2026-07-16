import type { DispatchStatus } from "../types";

const STYLES: Record<DispatchStatus, string> = {
  IN_PROGRESS: "badge badge-info",
  DISPATCHED: "badge badge-success",
  COMPLETED: "badge badge-success",
  AWAITING_REVIEW: "badge badge-warning",
  FAILED: "badge badge-error",
};

export function StatusBadge({ status }: { status: DispatchStatus }) {
  return <span className={STYLES[status]}>{status.replace("_", " ")}</span>;
}
