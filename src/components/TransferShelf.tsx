import {
  ArrowClockwise,
  CaretRight,
  DownloadSimple,
  FolderOpen,
  Pause,
  Play,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { Transfer } from "../types";

type TransferShelfProps = {
  transfers: Transfer[];
  activeCount: number;
  error: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (id: string) => void;
  onViewAll: () => void;
  onDismissError: () => void;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1_000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_000;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_000; index += 1) {
    value /= 1_000;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
};

const formatEta = (seconds: number | null) => {
  if (seconds === null) return "";
  if (seconds <= 0) return "Done";
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s left`;
};

const statusCopy = (transfer: Transfer) => {
  switch (transfer.status) {
    case "downloading":
      return [formatBytes(transfer.speedBytesPerSecond) + "/s", formatEta(transfer.etaSeconds)];
    case "requesting":
      return ["Contacting source", "Opening peer link"];
    case "remotelyQueued":
      return [
        transfer.queuePosition
          ? `Source queue · #${transfer.queuePosition}`
          : "In source queue",
        "Waiting for a slot",
      ];
    case "connecting":
      return ["Source ready", "Opening file stream"];
    case "queued":
      return ["Queued", "Next available slot"];
    case "paused":
      return ["Paused", "Progress saved"];
    case "completed":
      return ["Complete", "Show in folder"];
    case "failed":
      return ["Needs attention", transfer.error ?? "Ready to retry"];
  }
};

export function TransferShelf({
  transfers,
  activeCount,
  error,
  onPause,
  onResume,
  onCancel,
  onReveal,
  onViewAll,
  onDismissError,
}: TransferShelfProps) {
  const priority = (transfer: Transfer) => {
    if (["requesting", "remotelyQueued", "connecting", "downloading", "queued"].includes(transfer.status)) {
      return 0;
    }
    if (["paused", "failed"].includes(transfer.status)) return 1;
    return 2;
  };
  const visibleTransfers = [...transfers]
    .sort((left, right) => {
      const priorityDifference = priority(left) - priority(right);
      if (priorityDifference !== 0) return priorityDifference;
      return priority(left) === 2
        ? right.createdAtMs - left.createdAtMs
        : left.createdAtMs - right.createdAtMs;
    })
    .slice(0, 3);

  return (
    <section className="transfer-shelf" aria-label="Transfer activity">
      <div className="transfer-summary">
        <img src="/assets/night-geometry-cover.png" alt="" />
        <span>
          <strong>Transfers</strong>
          <small>
            <DownloadSimple size={14} weight="bold" />
            {activeCount} active · one at a time
          </small>
        </span>
      </div>

      <div className="transfer-list">
        <header>
          <span>
            Transfer queue <b>{transfers.length}</b>
          </span>
          <button type="button" onClick={onViewAll}>
            View all transfers <CaretRight size={12} weight="bold" />
          </button>
        </header>

        {error && (
          <div className="transfer-error" role="alert">
            <WarningCircle size={14} weight="fill" />
            <span>{error}</span>
            <button type="button" aria-label="Dismiss transfer error" onClick={onDismissError}>
              <X size={12} weight="bold" />
            </button>
          </div>
        )}

        {transfers.length === 0 ? (
          <div className="transfer-empty">
            Pick a live search result to make your first download.
          </div>
        ) : (
          visibleTransfers.map((transfer) => {
            const progress = Math.min(
              100,
              Math.max(0, (transfer.transferredBytes / transfer.sizeBytes) * 100),
            );
            const [status, detail] = statusCopy(transfer);
            const resumable = ["paused", "failed"].includes(transfer.status);
            const completed = transfer.status === "completed";
            return (
              <article
                className={`transfer-row is-${transfer.status}`}
                key={transfer.id}
              >
                <span className="transfer-name">
                  <strong>{transfer.title}</strong>
                  <small>{transfer.username}</small>
                </span>
                <span className="transfer-progress">
                  <i>
                    <b style={{ width: `${progress}%` }} />
                  </i>
                  <small>
                    {formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.sizeBytes)}
                  </small>
                </span>
                <span className="transfer-meta" title={transfer.error ?? undefined}>
                  {status}
                  <small>{detail}</small>
                </span>
                <button
                  type="button"
                  aria-label={
                    completed
                      ? `Show ${transfer.title} in folder`
                      : resumable
                        ? `${transfer.status === "failed" ? "Retry" : "Resume"} ${transfer.title}`
                        : `Pause ${transfer.title}`
                  }
                  onClick={() => {
                    if (completed) onReveal(transfer.id);
                    else if (resumable) onResume(transfer.id);
                    else onPause(transfer.id);
                  }}
                >
                  {completed ? (
                    <FolderOpen size={15} />
                  ) : transfer.status === "failed" ? (
                    <ArrowClockwise size={14} weight="bold" />
                  ) : resumable ? (
                    <Play size={14} weight="fill" />
                  ) : (
                    <Pause size={14} weight="fill" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`${completed ? "Remove" : "Cancel"} ${transfer.title}`}
                  onClick={() => onCancel(transfer.id)}
                >
                  <X size={14} weight="bold" />
                </button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
