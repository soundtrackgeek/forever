import {
  Archive,
  ArrowLineUp,
  ArrowClockwise,
  CaretUp,
  CaretDown,
  CheckCircle,
  DownloadSimple,
  DotsSixVertical,
  FolderOpen,
  MagnifyingGlass,
  Pause,
  Play,
  SlidersHorizontal,
  ShieldCheck,
  Timer,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { PersonProfile, ReleaseAlternativeSource, Transfer, Upload } from "../types";
import {
  groupTransfers,
  summarizeTransferGroups,
  type TransferGroup,
} from "../utils/transfers";
import { releaseHealth } from "../utils/finishLine";
import { CountryFlag } from "./CountryFlag";

type Filter = "all" | "active" | "queued" | "completed" | "attention";

type QueueDropTarget = {
  id: string;
  placement: "before" | "after";
};

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
  onReorderRelease: (id: string, beforeTransferId: string | null) => void;
  onClearCompleted: () => void;
  onVerifyRelease: (id: string) => void;
  onRetryReleaseIssues: (id: string) => void;
  onSwitchReleaseSource: (id: string, source: ReleaseAlternativeSource) => void;
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

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? path;

const transferStatus = (transfer: Transfer) => {
  switch (transfer.status) {
    case "requesting": return "Contacting";
    case "remotelyQueued": return transfer.queuePosition ? `Source queue #${transfer.queuePosition}` : "Source queue";
    case "connecting": return "Connecting";
    case "downloading": return "Downloading";
    case "queued": return "Queued";
    case "retrying": return `Auto retry ${transfer.retryCount ?? 1} of 3`;
    case "paused": return "Paused";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
};

const isVisibleInFilter = (group: TransferGroup, filter: Filter) => {
  const health = releaseHealth(group);
  if (filter === "all") return true;
  if (filter === "active") return group.status === "active" || group.status === "paused" || health.state === "recovering";
  if (filter === "attention") return health.state === "attention";
  if (filter === "queued") return group.status === "queued" && health.state !== "recovering";
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
  onReorderRelease,
  onClearCompleted,
  onVerifyRelease,
  onRetryReleaseIssues,
  onSwitchReleaseSource,
  onDismissError,
  personByUsername,
  onOpenPerson,
  onCancelUpload,
  onClearFinishedUploads,
  onDismissUploadError,
}: TransfersWorkspaceProps) {
  const [direction, setDirection] = useState<"downloads" | "uploads">("downloads");
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const groups = useMemo(() => groupTransfers(transfers), [transfers]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [draggedReleaseId, setDraggedReleaseId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<QueueDropTarget | null>(null);
  const mouseDrag = useRef<{ releaseId: string } | null>(null);
  const [expansion, setExpansion] = useState<{
    touched: boolean;
    ids: Set<string>;
  }>({ touched: false, ids: new Set() });
  const defaultOpenId =
    groups.find((group) => group.status === "active")?.id ??
    groups.find((group) => releaseHealth(group).state === "attention")?.id ?? groups[0]?.id;
  const queueSummary = useMemo(() => summarizeTransferGroups(groups), [groups]);
  const queuedGroups = useMemo(
    () => groups.filter((group) => group.status === "queued" && group.releaseId),
    [groups],
  );
  const queuedGroupById = useMemo(
    () => new Map(queuedGroups.map((group) => [group.id, group])),
    [queuedGroups],
  );

  const counts = {
    all: groups.length,
    active: groups.filter((group) => ["active", "paused"].includes(group.status) || releaseHealth(group).state === "recovering").length,
    queued: groups.filter((group) => group.status === "queued" && releaseHealth(group).state !== "recovering").length,
    completed: groups.filter((group) => group.status === "completed").length,
    attention: groups.filter((group) => releaseHealth(group).state === "attention").length,
  };
  const finishLineSummary = {
    verified: groups.filter((group) => releaseHealth(group).state === "verified").length,
    moved: groups.filter((group) => releaseHealth(group).state === "moved").length,
    recovering: groups.filter((group) => releaseHealth(group).state === "recovering").length,
    attention: groups.filter((group) => releaseHealth(group).state === "attention").length,
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

  const queuedTransferId = (group: TransferGroup | undefined) =>
    group?.transfers.find((transfer) => transfer.status === "queued")?.id ?? null;

  const moveQueuedRelease = (
    group: TransferGroup,
    direction: "next" | "up" | "down",
  ) => {
    if (!group.releaseId) return;
    const index = queuedGroups.findIndex((candidate) => candidate.id === group.id);
    if (index < 0) return;

    if (direction === "next" || direction === "up") {
      const target = direction === "next" ? queuedGroups[0] : queuedGroups[index - 1];
      const beforeTransferId = queuedTransferId(target);
      if (beforeTransferId) onReorderRelease(group.releaseId, beforeTransferId);
      return;
    }

    const beforeTransferId = queuedTransferId(queuedGroups[index + 2]);
    onReorderRelease(group.releaseId, beforeTransferId);
  };

  const finishDrop = (
    sourceReleaseId: string,
    target: TransferGroup,
    placement: "before" | "after",
  ) => {
    if (sourceReleaseId === target.releaseId) return;
    const remaining = queuedGroups.filter(
      (candidate) => candidate.releaseId !== sourceReleaseId,
    );
    const targetIndex = remaining.findIndex((candidate) => candidate.id === target.id);
    if (targetIndex < 0) return;
    const beforeGroup = remaining[targetIndex + (placement === "after" ? 1 : 0)];
    onReorderRelease(sourceReleaseId, queuedTransferId(beforeGroup));
  };

  const mouseTargetAt = (
    element: EventTarget | null,
    clientY: number,
    sourceReleaseId: string,
  ) => {
    const card = element instanceof Element
      ? element.closest<HTMLElement>("[data-queue-group-id]")
      : null;
    if (!card) return null;
    const target = queuedGroupById.get(card.dataset.queueGroupId ?? "");
    if (!target || target.releaseId === sourceReleaseId) return null;
    const bounds = card.getBoundingClientRect();
    const placement = clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    return {
      group: target,
      marker: { id: target.id, placement } satisfies QueueDropTarget,
    };
  };

  const updateMouseDrag = (event: MouseEvent<HTMLElement>) => {
    const drag = mouseDrag.current;
    if (!drag) return;
    event.preventDefault();
    const target = mouseTargetAt(event.target, event.clientY, drag.releaseId);
    setDropTarget((current) => {
      const next = target?.marker ?? null;
      return current?.id === next?.id && current?.placement === next?.placement
        ? current
        : next;
    });
  };

  const endMouseDrag = (event: MouseEvent<HTMLElement>) => {
    const drag = mouseDrag.current;
    if (!drag) return;
    event.preventDefault();
    const target = mouseTargetAt(event.target, event.clientY, drag.releaseId);
    if (target) finishDrop(drag.releaseId, target.group, target.marker.placement);
    mouseDrag.current = null;
    setDraggedReleaseId(null);
    setDropTarget(null);
  };

  return (
    <section
      className="transfers-workspace"
      onMouseMove={updateMouseDrag}
      onMouseUp={endMouseDrag}
      onMouseLeave={() => {
        if (!mouseDrag.current) return;
        mouseDrag.current = null;
        setDraggedReleaseId(null);
        setDropTarget(null);
      }}
    >
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

      {direction === "downloads" ? (
        <section className="transfer-queue-overview" aria-label="Download queue summary">
          <span className="transfer-queue-signal"><DownloadSimple size={18} weight="light" /></span>
          <span className="transfer-queue-overview-copy">
            <small>Signal order</small>
            <strong>
              {queueSummary.releaseCount
                ? `${queueSummary.releaseCount} ${queueSummary.releaseCount === 1 ? "release" : "releases"} · ${queueSummary.fileCount} ${queueSummary.fileCount === 1 ? "file" : "files"}`
                : "Queue clear"}
            </strong>
          </span>
          <span>
            <small>Remaining</small>
            <strong>{formatBytes(queueSummary.remainingBytes)}</strong>
          </span>
          <span>
            <small>Total queue ETA</small>
            <strong>{queueSummary.etaSeconds === null ? "Waiting for speed" : formatEta(queueSummary.etaSeconds)}</strong>
          </span>
        </section>
      ) : null}

      {direction === "downloads" ? (
        <section className="finish-line-overview" aria-label="Finish Line release health">
          <span className="finish-line-mark"><ShieldCheck size={20} weight="light" /></span>
          <span><small>Finish Line</small><strong>Every expected file, accounted for.</strong></span>
          <span className={finishLineSummary.recovering ? "is-recovering" : ""}><Timer size={15} /><small>Recovering</small><strong>{finishLineSummary.recovering}</strong></span>
          <span className={finishLineSummary.attention ? "is-attention" : ""}><WarningCircle size={15} /><small>Needs attention</small><strong>{finishLineSummary.attention}</strong></span>
          <span className="is-verified"><CheckCircle size={15} weight="fill" /><small>Safe history</small><strong>{finishLineSummary.verified + finishLineSummary.moved}</strong></span>
        </section>
      ) : null}

      {direction === "downloads" ? <div className="transfer-filters">
        <div role="tablist" aria-label="Transfer filters">
          {(["all", "active", "queued", "completed", "attention"] as const).map((value) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
              key={value}
            >
              {value === "attention" ? "Needs attention" : value[0].toUpperCase() + value.slice(1)} <span>{counts[value]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="clear-completed-button"
          disabled={counts.completed === 0}
          onClick={onClearCompleted}
        >
          Clear history
        </button>
        <button type="button" className="transfer-view-options" aria-label="Transfer view options">
          <SlidersHorizontal size={16} />
        </button>
      </div> : <div className="transfer-filters upload-toolbar">
        <p>{uploads.filter((upload) => upload.status === "uploading").length} active · {uploads.filter((upload) => upload.status === "queued").length} queued</p>
        <button type="button" className="clear-completed-button" disabled={!uploads.some((upload) => ["completed", "failed", "cancelled"].includes(upload.status))} onClick={onClearFinishedUploads}>Clear finished</button>
      </div>}

      <div className="transfer-list-stage">
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
            <h2>{groups.length ? "Nothing in this signal" : "Signal order is clear"}</h2>
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
          const health = releaseHealth(group);
          const retryInSeconds = health.nextRetryAtMs === null || clock === 0
            ? null
            : Math.max(0, Math.ceil((health.nextRetryAtMs - clock) / 1_000));
          const sourceNames = [...new Set(group.transfers.map((transfer) => transfer.username))];
          const moved = health.state === "moved";
          const recoverableIssues = !moved && (health.missingCount > 0 || health.failedCount > 0);
          const knownArt = group.title.toLocaleLowerCase().includes("night geometry");
          return (
            <article
              className={`release-transfer-card is-${group.status} health-${health.state}${draggedReleaseId === group.releaseId ? " is-reordering" : ""}${dropTarget?.id === group.id ? ` is-drop-${dropTarget.placement}` : ""}`}
              data-queue-group-id={group.status === "queued" && group.releaseId ? group.id : undefined}
              key={group.id}
            >
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
                    {sourceNames.length === 1 ? <button
                        type="button"
                        className="transfer-user-link"
                        onClick={() => onOpenPerson(group.username)}
                      >
                        <CountryFlag code={personByUsername(group.username)?.countryCode} />{group.username}
                      </button> : <strong className="transfer-multi-source">{sourceNames.length} sources</strong>}
                    <i aria-label="Online" />
                  </small>
                  <small>{group.transfers.length} {group.transfers.length === 1 ? "file" : "files"} · {formatBytes(group.sizeBytes)}</small>
                  <span className={`release-health-inline is-${health.state}`}>
                    {health.state === "verified" ? <ShieldCheck size={13} weight="fill" /> : moved ? <Archive size={13} weight="fill" /> : health.state === "attention" ? <WarningCircle size={13} weight="fill" /> : health.state === "recovering" ? <ArrowClockwise size={13} /> : <CheckCircle size={13} />}
                    <strong>{health.state === "verified" ? "Verified" : moved ? "Moved" : health.state === "attention" ? "Needs attention" : health.state === "recovering" ? `Auto recovery${retryInSeconds !== null ? ` in ${retryInSeconds}s` : ""}` : `${health.completedCount}/${group.transfers.length} complete`}</strong>
                    <small>{moved ? `${health.missingCount} ${health.missingCount === 1 ? "file" : "files"} moved from downloads` : `${health.verifiedCount} verified${health.missingCount ? ` · ${health.missingCount} missing` : ""}${health.mismatchCount ? ` · ${health.mismatchCount} size mismatch` : ""}`}</small>
                  </span>
                  {group.status === "queued" && group.releaseId ? (
                    <span className="release-queue-order">
                      <b>Queue #{group.queuePosition}</b>
                      <button
                        type="button"
                        className="release-drag-handle"
                        aria-label={`Drag ${group.title} to reorder`}
                        title="Hold and drag to reorder. Arrow keys also move this release."
                        onMouseDown={(event) => {
                          if (event.button !== 0 || !group.releaseId) return;
                          event.preventDefault();
                          mouseDrag.current = { releaseId: group.releaseId };
                          setDraggedReleaseId(group.releaseId);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            moveQueuedRelease(group, "up");
                          } else if (event.key === "ArrowDown") {
                            event.preventDefault();
                            moveQueuedRelease(group, "down");
                          } else if (event.key === "Home") {
                            event.preventDefault();
                            moveQueuedRelease(group, "next");
                          }
                        }}
                      >
                        <DotsSixVertical size={15} weight="bold" />
                      </button>
                      <button
                        type="button"
                        disabled={group.queuePosition === 1}
                        aria-label={`Download ${group.title} next`}
                        title="Download next"
                        onClick={() => moveQueuedRelease(group, "next")}
                      >
                        <ArrowLineUp size={14} weight="bold" /><small>Next</small>
                      </button>
                      <button
                        type="button"
                        disabled={group.queuePosition === 1}
                        aria-label={`Move ${group.title} up`}
                        title="Move up"
                        onClick={() => moveQueuedRelease(group, "up")}
                      >
                        <CaretUp size={13} weight="bold" />
                      </button>
                      <button
                        type="button"
                        disabled={group.queuePosition === queuedGroups.length}
                        aria-label={`Move ${group.title} down`}
                        title="Move down"
                        onClick={() => moveQueuedRelease(group, "down")}
                      >
                        <CaretDown size={13} weight="bold" />
                      </button>
                    </span>
                  ) : null}
                </span>
                <span className="release-transfer-total">
                  <strong>{completed ? "Completed" : `${formatBytes(group.transferredBytes)} / ${formatBytes(group.sizeBytes)} (${Math.round(progress)}%)`}</strong>
                  <i><b style={{ width: `${progress}%` }} /></i>
                  <small>
                    {health.state === "recovering" ? `Retry ${group.transfers.find((transfer) => transfer.status === "retrying")?.retryCount ?? 1} of 3${retryInSeconds !== null ? ` · in ${retryInSeconds}s` : ""}` : group.status === "active" ? `${formatBytes(group.speedBytesPerSecond)}/s${group.etaSeconds !== null ? ` · Album ETA ${formatEta(group.etaSeconds)}` : ""}` : group.status === "queued" ? `Queue #${group.queuePosition} · Waiting for slot…` : group.status === "paused" ? "Progress saved" : group.status === "failed" ? "Needs attention" : health.state === "attention" ? "Completed with issues" : moved ? "Moved out of the download folder" : "Ready in your download folder"}
                  </small>
                </span>
                <span className="release-transfer-actions">
                  <button
                    type="button"
                    aria-label={recoverableIssues ? `Retry issues in ${group.title}` : moved ? `Download ${group.title} again` : completed ? `Reveal ${group.title}` : resumable ? `Resume ${group.title}` : `Pause ${group.title}`}
                    onClick={() => {
                      if (recoverableIssues && group.releaseId) onRetryReleaseIssues(group.releaseId);
                      else if (moved && group.releaseId) onRetryReleaseIssues(group.releaseId);
                      else if (completed) invokeGroup(group, onRevealRelease, onReveal);
                      else if (resumable) invokeGroup(group, onResumeRelease, onResume);
                      else invokeGroup(group, onPauseRelease, onPause);
                    }}
                  >
                    {recoverableIssues || moved ? <ArrowClockwise size={17} /> : completed ? <FolderOpen size={18} /> : resumable ? <Play size={16} weight="fill" /> : <Pause size={16} weight="fill" />}
                    <small>{recoverableIssues ? "Retry issues" : moved ? "Download again" : completed ? "Reveal" : resumable ? "Resume" : "Pause"}</small>
                  </button>
                  {completed && group.releaseId ? <button type="button" aria-label={`Verify ${group.title}`} onClick={() => onVerifyRelease(group.releaseId!)}><ShieldCheck size={17} /><small>Verify</small></button> : null}
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
                  <section className={`finish-line-detail is-${health.state}`}>
                    <span className="finish-line-detail-icon">{health.state === "verified" ? <ShieldCheck size={19} weight="fill" /> : moved ? <Archive size={19} weight="fill" /> : health.state === "attention" ? <WarningCircle size={19} weight="fill" /> : <Timer size={19} />}</span>
                    <span><small>Release health</small><strong>{health.state === "verified" ? "All expected files verified" : moved ? "Filed away after download" : health.state === "attention" ? "The release needs a quick check" : health.state === "recovering" ? "Forever is recovering this signal" : `${health.completedCount} of ${group.transfers.length} files complete`}</strong><p>{health.state === "verified" ? "Filename presence and expected byte size both match." : moved ? "The complete release left Forever's download folder together, so it is treated as moved instead of damaged." : health.state === "attention" ? `${health.missingCount} missing · ${health.mismatchCount} size mismatch · ${health.failedCount} failed` : "Partial progress is preserved between every safe retry."}</p></span>
                    <span className="finish-line-file-counts"><b>{health.verifiedCount}<small>Verified</small></b><b>{health.pendingCount}<small>Pending</small></b><b>{moved ? health.missingCount : health.missingCount + health.mismatchCount + health.failedCount}<small>{moved ? "Moved" : "Issues"}</small></b></span>
                    {health.alternatives.length > 0 && group.releaseId ? <details className="finish-line-alternatives"><summary><ArrowClockwise size={14} /> Alternative signals <small>{health.alternatives.length}</small></summary><div>{health.alternatives.map((source) => {
                      const matchCount = group.transfers.filter((transfer) => source.files.some((file) => file.sizeBytes === transfer.sizeBytes && basename(file.remoteFilename).toLocaleLowerCase() === basename(transfer.remoteFilename).toLocaleLowerCase())).length;
                      return <button type="button" key={`${source.username}:${source.remoteFolder}`} disabled={matchCount === 0} onClick={() => onSwitchReleaseSource(group.releaseId!, source)}><span><strong>{source.username}</strong><small title={source.remoteFolder}>{source.remoteFolder.replace(/[\\/]/g, " / ")}</small></span><b>{matchCount}/{group.transfers.length} exact</b><em>Try source</em></button>;
                    })}</div></details> : null}
                  </section>
                  <div className="release-file-header" aria-hidden="true">
                    <span>#</span><span>Filename</span><span>Size</span><span>Progress</span><span>Status</span><span />
                  </div>
                  {group.transfers.map((transfer, index) => {
                    const fileProgress = transfer.sizeBytes
                      ? Math.min(100, (transfer.transferredBytes / transfer.sizeBytes) * 100)
                      : 0;
                    const fileResumable = transfer.status === "paused" || transfer.status === "failed" || transfer.status === "retrying";
                    const fileCompleted = transfer.status === "completed";
                    const fileMoved = moved && transfer.verificationStatus === "missing";
                    const fileIssue = !fileMoved && (transfer.verificationStatus === "missing" || transfer.verificationStatus === "sizeMismatch");
                    return (
                      <div className={`release-file-row is-${transfer.status}`} key={transfer.id}>
                        <span className="release-file-number">{transfer.fileIndex ?? index + 1}</span>
                        <span className="release-file-name"><strong>{transfer.title}</strong><small>{transfer.remoteFilename.split(".").slice(-1)[0]?.toUpperCase() ?? "FILE"}</small></span>
                        <span>{formatBytes(transfer.sizeBytes)}</span>
                        <span className="release-file-progress"><i><b style={{ width: `${fileProgress}%` }} /></i><small>{Math.round(fileProgress)}%</small></span>
                        <span className={`release-file-status is-${fileMoved ? "moved" : transfer.verificationStatus ?? "pending"}`} title={fileMoved ? "This completed release was moved out of Forever's download folder." : transfer.verificationMessage ?? transfer.error ?? undefined}>
                          {transfer.verificationStatus === "verified" ? <ShieldCheck size={13} weight="fill" /> : fileMoved ? <Archive size={13} weight="fill" /> : fileIssue ? <WarningCircle size={13} weight="fill" /> : fileCompleted ? <CheckCircle size={13} weight="fill" /> : null}
                          {transfer.verificationStatus === "verified" ? "Verified" : fileMoved ? "Moved" : transfer.verificationStatus === "missing" ? "Missing" : transfer.verificationStatus === "sizeMismatch" ? "Size mismatch" : transferStatus(transfer)}
                        </span>
                        <span className="release-file-actions">
                          <button
                            type="button"
                            aria-label={fileMoved && group.releaseId ? `Download ${group.title} again` : fileIssue && group.releaseId ? `Retry issues in ${group.title}` : fileCompleted ? `Reveal ${transfer.title}` : fileResumable ? `Resume ${transfer.title}` : `Pause ${transfer.title}`}
                            onClick={() => fileMoved && group.releaseId ? onRetryReleaseIssues(group.releaseId) : fileIssue && group.releaseId ? onRetryReleaseIssues(group.releaseId) : fileCompleted ? onReveal(transfer.id) : fileResumable ? onResume(transfer.id) : onPause(transfer.id)}
                          >
                            {fileMoved || fileIssue ? <ArrowClockwise size={14} /> : fileCompleted ? <FolderOpen size={14} /> : ["failed", "retrying"].includes(transfer.status) ? <ArrowClockwise size={14} /> : fileResumable ? <Play size={13} weight="fill" /> : <Pause size={13} weight="fill" />}
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
      </div>
    </section>
  );
}
