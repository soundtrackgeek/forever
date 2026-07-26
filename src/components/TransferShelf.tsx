import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  CaretUp,
  DownloadSimple,
  FolderOpen,
  Pause,
  Play,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { PersonProfile, Transfer } from "../types";
import { CountryFlag } from "./CountryFlag";
import { groupTransfers, type TransferGroup } from "../utils/transfers";

type TransferShelfProps = {
  expanded: boolean;
  transfers: Transfer[];
  activeCount: number;
  error: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (id: string) => void;
  onPauseRelease: (id: string) => void;
  onResumeRelease: (id: string) => void;
  onCancelRelease: (id: string) => void;
  onRevealRelease: (id: string) => void;
  onViewAll: () => void;
  onDismissError: () => void;
  personByUsername: (username: string) => PersonProfile | null;
  onOpenPerson: (username: string) => void;
  onToggle: () => void;
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

const formatEta = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const groupStatus = (group: TransferGroup) => {
  if (group.status === "active") {
    return `${formatBytes(group.speedBytesPerSecond)}/s${group.etaSeconds ? ` · Album ETA ${formatEta(group.etaSeconds)}` : ""}`;
  }
  if (group.status === "queued") return "Waiting";
  if (group.status === "paused") return "Paused";
  if (group.status === "failed") return "Retry";
  return "Completed";
};

export function TransferShelf({
  expanded,
  transfers,
  activeCount,
  error,
  onPause,
  onResume,
  onCancel,
  onReveal,
  onPauseRelease,
  onResumeRelease,
  onCancelRelease,
  onRevealRelease,
  onViewAll,
  onDismissError,
  personByUsername,
  onOpenPerson,
  onToggle,
}: TransferShelfProps) {
  const groups = groupTransfers(transfers);
  const visibleGroups = groups.slice(0, 3);

  const invokeGroup = (
    group: TransferGroup,
    releaseAction: (id: string) => void,
    fileAction: (id: string) => void,
  ) => {
    if (group.releaseId) releaseAction(group.releaseId);
    else group.transfers.forEach((transfer) => fileAction(transfer.id));
  };

  return (
    <section
      className={`transfer-shelf ${expanded ? "is-expanded" : "is-collapsed"}`}
      aria-label="Transfer activity"
    >
      <div
        className="transfer-shelf-panel"
        id="transfer-shelf-panel"
        hidden={!expanded}
      >
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
            <span>Release queue <b>{groups.length}</b></span>
            <span className="transfer-list-actions">
              <button type="button" onClick={onViewAll}>
                View all transfers <CaretRight size={12} weight="bold" />
              </button>
              <button
                type="button"
                aria-expanded="true"
                aria-controls="transfer-shelf-panel"
                aria-label="Collapse transfer activity"
                onClick={onToggle}
              >
                Collapse <CaretDown size={12} weight="bold" />
              </button>
            </span>
          </header>

          {error ? (
            <div className="transfer-error" role="alert">
              <WarningCircle size={14} weight="fill" /><span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss transfer error"
                onClick={onDismissError}
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="transfer-empty">
              Browse a source folder to make your first release download.
            </div>
          ) : visibleGroups.map((group) => {
            const progress = group.sizeBytes
              ? Math.min(100, (group.transferredBytes / group.sizeBytes) * 100)
              : 0;
            const resumable = group.status === "paused" || group.status === "failed";
            const completed = group.status === "completed";
            return (
              <article className={`transfer-row is-${group.status}`} key={group.id}>
                <span className="transfer-name">
                  <strong>{group.title}</strong>
                  <small>
                    <button
                      type="button"
                      className="transfer-user-link"
                      onClick={() => onOpenPerson(group.username)}
                    >
                      <CountryFlag code={personByUsername(group.username)?.countryCode} />
                      {group.username}
                    </button>{" "}
                    · {group.transfers.length} files
                  </small>
                </span>
                <span className="transfer-progress">
                  <i><b style={{ width: `${progress}%` }} /></i>
                  <small>
                    {formatBytes(group.transferredBytes)} / {formatBytes(group.sizeBytes)}
                  </small>
                </span>
                <span className="transfer-meta">
                  <strong>{groupStatus(group)}</strong>
                  <small>{Math.round(progress)}%</small>
                </span>
                <button
                  type="button"
                  aria-label={completed ? `Reveal ${group.title}` : resumable ? `Resume ${group.title}` : `Pause ${group.title}`}
                  onClick={() => completed
                    ? invokeGroup(group, onRevealRelease, onReveal)
                    : resumable
                      ? invokeGroup(group, onResumeRelease, onResume)
                      : invokeGroup(group, onPauseRelease, onPause)}
                >
                  {completed
                    ? <FolderOpen size={15} />
                    : group.status === "failed"
                      ? <ArrowClockwise size={14} weight="bold" />
                      : resumable
                        ? <Play size={14} weight="fill" />
                        : <Pause size={14} weight="fill" />}
                </button>
                <button
                  type="button"
                  aria-label={`${completed ? "Remove" : "Cancel"} ${group.title}`}
                  onClick={() => invokeGroup(group, onCancelRelease, onCancel)}
                >
                  <X size={14} weight="bold" />
                </button>
              </article>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className={`transfer-shelf-expand ${error ? "has-error" : ""}`}
        aria-expanded="false"
        aria-controls="transfer-shelf-panel"
        aria-label="Expand transfer activity"
        onClick={onToggle}
        hidden={expanded}
      >
        <span className="transfer-shelf-expand-copy">
          <i><DownloadSimple size={16} weight="bold" /></i>
          <strong>Transfers</strong>
          <small>
            {activeCount} active · {groups.length} {groups.length === 1 ? "release" : "releases"}
          </small>
          {error ? (
            <WarningCircle size={14} weight="fill" aria-label="Transfer needs attention" />
          ) : null}
        </span>
        <span className="transfer-shelf-expand-action">
          Expand <CaretUp size={12} weight="bold" />
        </span>
      </button>
    </section>
  );
}
