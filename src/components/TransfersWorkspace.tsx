import {
  ArrowClockwise,
  CaretDown,
  CheckCircle,
  DownloadSimple,
  FolderOpen,
  MagnifyingGlass,
  Pause,
  Play,
  SlidersHorizontal,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { PersonProfile, Transfer, Upload } from "../types";
import { groupTransfers, type TransferGroup } from "../utils/transfers";
import { CountryFlag } from "./CountryFlag";

type Filter = "all" | "active" | "queued" | "completed" | "failed";

type TransfersWorkspaceProps = {
  transfers: Transfer[];
  uploads: Upload[];
  uploadError: string | null;
  error: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (id: string) => void;
  onPauseRelease: (id: string) => void;
  onResumeRelease: (id: string) => void;
  onCancelRelease: (id: string) => void;
  onRevealRelease: (id: string) => void;
  onClearCompleted: () => void;
  onDismissError: () => void;
  personByUsername: (username: string) => PersonProfile | null;
  onOpenPerson: (username: string) => void;
  onCancelUpload: (id: string) => void;
  onClearFinishedUploads: () => void;
  onDismissUploadError: () => void;
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
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const transferStatus = (transfer: Transfer) => {
  switch (transfer.status) {
    case "requesting": return "Contacting";
    case "remotelyQueued": return transfer.queuePosition ? `Source queue #${transfer.queuePosition}` : "Source queue";
    case "connecting": return "Connecting";
    case "downloading": return "Downloading";
    case "queued": return "Queued";
    case "paused": return "Paused";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
};

const isVisibleInFilter = (group: TransferGroup, filter: Filter) => {
  if (filter === "all") return true;
  if (filter === "active") return group.status === "active" || group.status === "paused";
  return group.status === filter;
};

export function TransfersWorkspace({
  transfers,
  uploads,
  uploadError,
  error,
  onPause,
  onResume,
  onCancel,
  onReveal,
  onPauseRelease,
  onResumeRelease,
  onCancelRelease,
  onRevealRelease,
  onClearCompleted,
  onDismissError,
  personByUsername,
  onOpenPerson,
  onCancelUpload,
  onClearFinishedUploads,
  onDismissUploadError,
}: TransfersWorkspaceProps) {
  const [direction, setDirection] = useState<"downloads" | "uploads">("downloads");
  const groups = useMemo(() => groupTransfers(transfers), [transfers]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expansion, setExpansion] = useState<{
    touched: boolean;
    ids: Set<string>;
  }>({ touched: false, ids: new Set() });
  const defaultOpenId =
    groups.find((group) => group.status === "active")?.id ?? groups[0]?.id;

  const counts = {
    all: groups.length,
    active: groups.filter((group) => group.status === "active" || group.status === "paused").length,
    queued: groups.filter((group) => group.status === "queued").length,
    completed: groups.filter((group) => group.status === "completed").length,
    failed: groups.filter((group) => group.status === "failed").length,
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = groups.filter(
    (group) =>
      isVisibleInFilter(group, filter) &&
      (!normalizedQuery ||
        group.title.toLocaleLowerCase().includes(normalizedQuery) ||
        group.username.toLocaleLowerCase().includes(normalizedQuery) ||
        group.transfers.some((transfer) =>
          transfer.title.toLocaleLowerCase().includes(normalizedQuery),
        )),
  );

  const invokeGroup = (
    group: TransferGroup,
    releaseAction: (id: string) => void,
    fileAction: (id: string) => void,
  ) => {
    if (group.releaseId) releaseAction(group.releaseId);
    else group.transfers.forEach((transfer) => fileAction(transfer.id));
  };

  return (
    <section className="transfers-workspace">
      <header className="transfers-heading">
        <div>
          <h1>Transfers</h1>
          <p>{direction === "downloads" ? "Complete releases, one carefully resumed file at a time." : "Every outgoing file, clearly queued and in sight."}</p>
        </div>
        <label className="transfer-search">
          <MagnifyingGlass size={16} weight="light" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search transfers"
            aria-label="Search transfers"
          />
        </label>
      </header>

      <div className="transfer-direction-tabs" role="tablist" aria-label="Transfer direction">
        <button type="button" role="tab" aria-selected={direction === "downloads"} className={direction === "downloads" ? "is-active" : ""} onClick={() => setDirection("downloads")}>
          <DownloadSimple size={15} /> Downloads <span>{transfers.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={direction === "uploads"} className={direction === "uploads" ? "is-active" : ""} onClick={() => setDirection("uploads")}>
          <UploadSimple size={15} /> Uploads <span>{uploads.length}</span>
        </button>
      </div>

      {direction === "downloads" ? <div className="transfer-filters">
        <div role="tablist" aria-label="Transfer filters">
          {(["all", "active", "queued", "completed", "failed"] as const).map((value) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
              key={value}
            >
              {value[0].toUpperCase() + value.slice(1)} <span>{counts[value]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="clear-completed-button"
          disabled={counts.completed === 0}
          onClick={onClearCompleted}
        >
          Clear completed
        </button>
        <button type="button" className="transfer-view-options" aria-label="Transfer view options">
          <SlidersHorizontal size={16} />
        </button>
      </div> : <div className="transfer-filters upload-toolbar">
        <p>{uploads.filter((upload) => upload.status === "uploading").length} active · {uploads.filter((upload) => upload.status === "queued").length} queued</p>
        <button type="button" className="clear-completed-button" disabled={!uploads.some((upload) => ["completed", "failed", "cancelled"].includes(upload.status))} onClick={onClearFinishedUploads}>Clear finished</button>
      </div>}

      {error && direction === "downloads" && (
        <div className="workspace-transfer-error" role="alert">
          <WarningCircle size={15} weight="fill" />
          <span>{error}</span>
          <button type="button" aria-label="Dismiss transfer error" onClick={onDismissError}><X size={13} /></button>
        </div>
      )}

      {uploadError && direction === "uploads" ? (
        <div className="workspace-transfer-error" role="alert">
          <WarningCircle size={15} weight="fill" />
          <span>{uploadError}</span>
          <button type="button" aria-label="Dismiss upload error" onClick={onDismissUploadError}><X size={13} /></button>
        </div>
      ) : null}

      <div className="release-transfer-list" aria-live="polite">
        {direction === "uploads" ? (
          uploads.length === 0 ? (
            <div className="transfers-empty-state">
              <UploadSimple size={30} weight="thin" />
              <h2>No outgoing signals yet</h2>
              <p>Uploads appear here when another Soulseek user requests a shared file.</p>
            </div>
          ) : uploads.map((upload) => {
            const progress = upload.sizeBytes ? Math.min(100, upload.transferredBytes / upload.sizeBytes * 100) : 0;
            const finished = ["completed", "failed", "cancelled"].includes(upload.status);
            return (
              <article className={`upload-transfer-card is-${upload.status}`} key={upload.id}>
                <span className="upload-signal-icon"><UploadSimple size={19} weight="light" /></span>
                <span className="upload-transfer-name">
                  <strong>{upload.filename}</strong>
                  <small>to <button type="button" className="transfer-user-link" onClick={() => onOpenPerson(upload.username)}><CountryFlag code={personByUsername(upload.username)?.countryCode} />{upload.username}</button> · {formatBytes(upload.sizeBytes)}</small>
                  <em title={upload.remoteFilename}>{upload.remoteFilename}</em>
                </span>
                <span className="upload-transfer-progress">
                  <span><strong>{upload.status === "uploading" ? "Uploading" : upload.status[0].toUpperCase() + upload.status.slice(1)}</strong><small>{Math.round(progress)}%</small></span>
                  <i><b style={{ width: `${progress}%` }} /></i>
                  <small>{formatBytes(upload.transferredBytes)} / {formatBytes(upload.sizeBytes)}{upload.speedBytesPerSecond ? ` · ${formatBytes(upload.speedBytesPerSecond)}/s` : ""}{upload.etaSeconds !== null && upload.status === "uploading" ? ` · ${formatEta(upload.etaSeconds)}` : ""}</small>
                </span>
                <button type="button" onClick={() => onCancelUpload(upload.id)} aria-label={`${finished ? "Remove" : "Cancel"} upload ${upload.filename}`}>
                  <X size={15} /> <small>{finished ? "Remove" : "Cancel"}</small>
                </button>
                {upload.error ? <p>{upload.error}</p> : null}
              </article>
            );
          })
        ) : visibleGroups.length === 0 ? (
          <div className="transfers-empty-state">
            <DownloadSimple size={30} weight="thin" />
            <h2>{groups.length ? "Nothing in this signal" : "Your queue is quiet"}</h2>
            <p>{groups.length ? "Try another filter or search term." : "Browse a source folder from Search to download a release."}</p>
          </div>
        ) : visibleGroups.map((group) => {
          const open = expansion.touched
            ? expansion.ids.has(group.id)
            : group.id === defaultOpenId;
          const progress = group.sizeBytes
            ? Math.min(100, (group.transferredBytes / group.sizeBytes) * 100)
            : 0;
          const resumable = group.status === "paused" || group.status === "failed";
          const completed = group.status === "completed";
          const knownArt = group.title.toLocaleLowerCase().includes("night geometry");
          return (
            <article className={`release-transfer-card is-${group.status}`} key={group.id}>
              <div className="release-transfer-summary">
                {knownArt ? (
                  <img src="/assets/night-geometry-cover.png" alt="" />
                ) : (
                  <span className="release-cover-placeholder"><DownloadSimple size={24} weight="thin" /></span>
                )}
                <span className="release-transfer-identity">
                  <strong>{group.title}</strong>
                  <small>
                    from{" "}
                    <button
                      type="button"
                      className="transfer-user-link"
                      onClick={() => onOpenPerson(group.username)}
                    >
                      <CountryFlag code={personByUsername(group.username)?.countryCode} />{group.username}
                    </button>
                    <i aria-label="Online" />
                  </small>
                  <small>{group.transfers.length} {group.transfers.length === 1 ? "file" : "files"} · {formatBytes(group.sizeBytes)}</small>
                </span>
                <span className="release-transfer-total">
                  <strong>{completed ? "Completed" : `${formatBytes(group.transferredBytes)} / ${formatBytes(group.sizeBytes)} (${Math.round(progress)}%)`}</strong>
                  <i><b style={{ width: `${progress}%` }} /></i>
                  <small>
                    {group.status === "active" ? `${formatBytes(group.speedBytesPerSecond)}/s${group.etaSeconds !== null ? ` · Album ETA ${formatEta(group.etaSeconds)}` : ""}` : group.status === "queued" ? "Waiting for slot…" : group.status === "paused" ? "Progress saved" : group.status === "failed" ? "Needs attention" : "Ready in your download folder"}
                  </small>
                </span>
                <span className="release-transfer-actions">
                  <button
                    type="button"
                    aria-label={completed ? `Reveal ${group.title}` : resumable ? `Resume ${group.title}` : `Pause ${group.title}`}
                    onClick={() => {
                      if (completed) invokeGroup(group, onRevealRelease, onReveal);
                      else if (resumable) invokeGroup(group, onResumeRelease, onResume);
                      else invokeGroup(group, onPauseRelease, onPause);
                    }}
                  >
                    {completed ? <FolderOpen size={18} /> : resumable ? <Play size={16} weight="fill" /> : <Pause size={16} weight="fill" />}
                    <small>{completed ? "Reveal" : resumable ? "Resume" : "Pause"}</small>
                  </button>
                  <button
                    type="button"
                    aria-label={`${completed ? "Remove" : "Cancel"} ${group.title}`}
                    onClick={() => invokeGroup(group, onCancelRelease, onCancel)}
                  >
                    <X size={17} />
                    <small>{completed ? "Remove" : "Cancel"}</small>
                  </button>
                  <button
                    type="button"
                    className="release-expand-button"
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} ${group.title}`}
                    onClick={() => setExpansion((current) => {
                      const next = new Set(
                        current.touched
                          ? current.ids
                          : defaultOpenId
                            ? [defaultOpenId]
                            : [],
                      );
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return { touched: true, ids: next };
                    })}
                  >
                    <CaretDown size={16} weight="bold" />
                  </button>
                </span>
              </div>

              {open && (
                <div className="release-file-table">
                  <div className="release-file-header" aria-hidden="true">
                    <span>#</span><span>Filename</span><span>Size</span><span>Progress</span><span>Status</span><span />
                  </div>
                  {group.transfers.map((transfer, index) => {
                    const fileProgress = transfer.sizeBytes
                      ? Math.min(100, (transfer.transferredBytes / transfer.sizeBytes) * 100)
                      : 0;
                    const fileResumable = transfer.status === "paused" || transfer.status === "failed";
                    const fileCompleted = transfer.status === "completed";
                    return (
                      <div className={`release-file-row is-${transfer.status}`} key={transfer.id}>
                        <span className="release-file-number">{transfer.fileIndex ?? index + 1}</span>
                        <span className="release-file-name"><strong>{transfer.title}</strong><small>{transfer.remoteFilename.split(".").slice(-1)[0]?.toUpperCase() ?? "FILE"}</small></span>
                        <span>{formatBytes(transfer.sizeBytes)}</span>
                        <span className="release-file-progress"><i><b style={{ width: `${fileProgress}%` }} /></i><small>{Math.round(fileProgress)}%</small></span>
                        <span className="release-file-status" title={transfer.error ?? undefined}>
                          {fileCompleted && <CheckCircle size={13} weight="fill" />}
                          {transferStatus(transfer)}
                        </span>
                        <span className="release-file-actions">
                          <button
                            type="button"
                            aria-label={fileCompleted ? `Reveal ${transfer.title}` : fileResumable ? `Resume ${transfer.title}` : `Pause ${transfer.title}`}
                            onClick={() => fileCompleted ? onReveal(transfer.id) : fileResumable ? onResume(transfer.id) : onPause(transfer.id)}
                          >
                            {fileCompleted ? <FolderOpen size={14} /> : transfer.status === "failed" ? <ArrowClockwise size={14} /> : fileResumable ? <Play size={13} weight="fill" /> : <Pause size={13} weight="fill" />}
                          </button>
                          <button type="button" aria-label={`${fileCompleted ? "Remove" : "Cancel"} ${transfer.title}`} onClick={() => onCancel(transfer.id)}><X size={13} /></button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
