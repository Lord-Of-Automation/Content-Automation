import type { N8nStatus } from "@/lib/n8n";

const LABELS: Record<N8nStatus, string> = {
  new: "Queued",
  running: "Running",
  waiting: "Waiting",
  success: "Success",
  error: "Failed",
  crashed: "Crashed",
  canceled: "Canceled",
  unknown: "Unknown",
};

export default function StatusBadge({ status }: { status: N8nStatus }) {
  return (
    <span className={`badge badge-${status}`}>{LABELS[status] ?? status}</span>
  );
}
