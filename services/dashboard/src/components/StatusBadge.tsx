import type { DispatchStatus } from "../types";

const STYLES: Record<DispatchStatus, string> = {
  IN_PROGRESS: "badge badge-info",
  DISPATCHED: "badge badge-success",
  COMPLETED: "badge badge-success",
  AWAITING_REVIEW: "badge badge-warning",
  FAILED: "badge badge-error",
};

const LABELS: Record<DispatchStatus, string> = {
  IN_PROGRESS: "In progress",
  DISPATCHED: "Ambulance dispatched",
  COMPLETED: "Complete",
  AWAITING_REVIEW: "Needs human review",
  FAILED: "Could not dispatch",
};

export function StatusBadge({ status }: { status: DispatchStatus }) {
  return <span className={STYLES[status]}>{LABELS[status]}</span>;
}
