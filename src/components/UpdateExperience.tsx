import {
  ArrowClockwise,
  CheckCircle,
  DownloadSimple,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import type { useAppUpdater } from "../hooks/useAppUpdater";

type UpdateExperienceProps = ReturnType<typeof useAppUpdater>;

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
}: UpdateExperienceProps) {
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
            className="update-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <header>
              <span className="update-modal-mark">
                <Sparkle size={22} weight="fill" />
              </span>
              <button type="button" aria-label="Close update" onClick={closeModal}>
                <X size={17} />
              </button>
            </header>

            {status === "error" ? (
              <>
                <div className="update-heading">
                  <span>Update interrupted</span>
                  <h2 id="update-title">We couldn’t check for updates.</h2>
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
                    <p>{details.body}</p>
                  </div>

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
                      disabled={status === "downloading"}
                    >
                      Later
                    </button>
                    {status === "ready" ? (
                      <button
                        type="button"
                        className="modal-primary"
                        onClick={() => window.location.reload()}
                      >
                        <CheckCircle size={18} weight="fill" /> Restart Forever
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="modal-primary"
                        disabled={status === "downloading"}
                        onClick={() => void installUpdate()}
                      >
                        <DownloadSimple size={18} weight="bold" />
                        {status === "downloading"
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
