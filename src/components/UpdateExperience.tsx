import {
  ArrowClockwise,
  CheckCircle,
  DownloadSimple,
  HourglassMedium,
  Pause,
  ShieldCheck,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import type { useAppUpdater } from "../hooks/useAppUpdater";
import type { TransferQueueSnapshot } from "../types";

type TransferPreparationMode = "pauseNow" | "finishCurrentFiles";

type UpdateExperienceProps = ReturnType<typeof useAppUpdater> & {
  transfers: TransferQueueSnapshot;
  onPrepareTransfers: (mode: TransferPreparationMode) => Promise<unknown>;
  onCancelPreparation: () => Promise<unknown>;
};

const plainMarkdown = (value: string) =>
  value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .trim();

function ReleaseNotes({ body }: { body: string }) {
  const lines = body.split(/\r?\n/);
  const content: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    content.push(
      <ul key={`list-${content.length}`}>
        {bullets.map((bullet, index) => <li key={`${index}-${bullet}`}>{plainMarkdown(bullet)}</li>)}
      </ul>,
    );
    bullets = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      continue;
    }
    if (/^\s{2,}\S/.test(rawLine) && bullets.length) {
      bullets[bullets.length - 1] += ` ${line}`;
      continue;
    }
    if (/^##\s+What.s new in Forever/i.test(line)) continue;
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();
    if (/^#{2,6}\s+/.test(line)) {
      content.push(<h3 key={`heading-${content.length}`}>{plainMarkdown(line.replace(/^#{2,6}\s+/, ""))}</h3>);
    } else {
      content.push(<p key={`paragraph-${content.length}`}>{plainMarkdown(line)}</p>);
    }
  }
  flushBullets();

  return <div className="release-notes-content">{content}</div>;
}

export function UpdateExperience({
  status,
  details,
  progress,
  error,
  isModalOpen,
  shouldShowToast,
  checkForUpdates,
  installUpdate,
  openModal,
  closeModal,
  remindLater,
  transfers,
  onPrepareTransfers,
  onCancelPreparation,
}: UpdateExperienceProps) {
  const [preparationMode, setPreparationMode] =
    useState<TransferPreparationMode | null>(null);
  const pendingTransferCount = useMemo(
    () => transfers.transfers.filter(
      (transfer) => transfer.status !== "completed",
    ).length,
    [transfers.transfers],
  );
  const preparing = status === "preparing";
  const startSafeUpdate = (mode: TransferPreparationMode) => {
    setPreparationMode(mode);
    void installUpdate(
      () => onPrepareTransfers(mode),
      onCancelPreparation,
    );
  };

  if (!details && status !== "error") return null;

  return (
    <>
      {shouldShowToast && details && (
        <aside className="update-toast" aria-live="polite">
          <span className="update-toast-icon">
            <Sparkle size={18} weight="fill" />
          </span>
          <span className="update-toast-copy">
            <strong>Forever {details.version} is available</strong>
            <small>A new Midnight Radio release is ready.</small>
          </span>
          <button type="button" className="toast-update" onClick={openModal}>
            Update
          </button>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Remind me later"
            onClick={remindLater}
          >
            <X size={14} weight="bold" />
          </button>
        </aside>
      )}

      {isModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className={`update-modal ${pendingTransferCount > 0 ? "is-safe-passage" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <header>
              <span className="update-modal-mark">
                <Sparkle size={22} weight="fill" />
              </span>
              <button
                type="button"
                aria-label="Close update"
                onClick={closeModal}
                disabled={preparing || status === "downloading"}
              >
                <X size={17} />
              </button>
            </header>

            {status === "error" ? (
              <>
                <div className="update-heading">
                  <span>Update interrupted</span>
                  <h2 id="update-title">
                    {details
                      ? "We couldn’t complete the update."
                      : "We couldn’t check for updates."}
                  </h2>
                  <p>{error || "Check your connection and try again."}</p>
                </div>
                <div className="update-modal-actions">
                  <button type="button" className="modal-secondary" onClick={closeModal}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="modal-primary"
                    onClick={() => void checkForUpdates(true)}
                  >
                    <ArrowClockwise size={17} weight="bold" /> Try again
                  </button>
                </div>
              </>
            ) : (
              details && (
                <>
                  <div className="update-heading">
                    <span>New transmission</span>
                    <h2 id="update-title">Forever {details.version} is ready.</h2>
                    <p>
                      You’re using {details.currentVersion}. The update is signed and
                      will be verified before installation.
                    </p>
                  </div>

                  <div className="release-notes">
                    <span>What’s new</span>
                    <ReleaseNotes body={details.body} />
                  </div>

                  {status === "available" && pendingTransferCount > 0 ? (
                    <section
                      className="safe-passage-options"
                      aria-label="Safe Passage update choices"
                    >
                      <header>
                        <ShieldCheck size={18} weight="fill" />
                        <span>
                          <small>Safe Passage</small>
                          <strong>
                            {pendingTransferCount} unfinished {pendingTransferCount === 1 ? "file is" : "files are"} protected.
                          </strong>
                        </span>
                      </header>
                      <button
                        type="button"
                        onClick={() => startSafeUpdate("pauseNow")}
                      >
                        <Pause size={17} weight="fill" />
                        <span>
                          <strong>Pause safely &amp; update</strong>
                          <small>Flush partial files, install now, and resume after restart.</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => startSafeUpdate("finishCurrentFiles")}
                        disabled={transfers.activeCount === 0}
                      >
                        <HourglassMedium size={18} />
                        <span>
                          <strong>Finish active files first</strong>
                          <small>
                            Start nothing new, then update when {transfers.activeCount} active {transfers.activeCount === 1 ? "file is" : "files are"} complete.
                          </small>
                        </span>
                      </button>
                    </section>
                  ) : null}

                  {preparing ? (
                    <div className="safe-passage-preparing" role="status">
                      <span className="search-spinner"><HourglassMedium size={18} /></span>
                      <span>
                        <small>Update scheduled</small>
                        <strong>
                          {preparationMode === "finishCurrentFiles"
                            ? "Finishing active files…"
                            : "Securing partial downloads…"}
                        </strong>
                        <p>No new download will start. Forever installs when every file handle is safely closed.</p>
                      </span>
                      {preparationMode === "finishCurrentFiles" ? (
                        <button
                          type="button"
                          onClick={() => void onPrepareTransfers("pauseNow")}
                        >
                          Pause now instead
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {(status === "downloading" || status === "ready") && (
                    <div className="update-progress">
                      <span>
                        {status === "ready" ? "Ready to restart" : "Downloading update"}
                        <strong>{progress}%</strong>
                      </span>
                      <i>
                        <b style={{ width: `${progress}%` }} />
                      </i>
                    </div>
                  )}

                  <div className="update-modal-actions">
                    <button
                      type="button"
                      className="modal-secondary"
                      onClick={remindLater}
                      disabled={preparing || status === "downloading"}
                    >
                      {pendingTransferCount > 0 && status === "available"
                        ? "Keep downloading"
                        : "Later"}
                    </button>
                    {status === "ready" ? (
                      <button
                        type="button"
                        className="modal-primary"
                        onClick={() => window.location.reload()}
                      >
                        <CheckCircle size={18} weight="fill" /> Restart Forever
                      </button>
                    ) : status === "available" && pendingTransferCount > 0 ? null : (
                      <button
                        type="button"
                        className="modal-primary"
                        disabled={preparing || status === "downloading"}
                        onClick={() => void installUpdate()}
                      >
                        <DownloadSimple size={18} weight="bold" />
                        {preparing
                          ? "Securing downloads"
                          : status === "downloading"
                          ? `Downloading ${progress}%`
                          : "Update Forever"}
                      </button>
                    )}
                  </div>
                </>
              )
            )}
          </section>
        </div>
      )}
    </>
  );
}
