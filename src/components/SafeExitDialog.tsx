import { Pause, ShieldCheck, X } from "@phosphor-icons/react";

type SafeExitDialogProps = {
  open: boolean;
  activeCount: number;
  preparing: boolean;
  onKeepRunning: () => void;
  onPauseAndExit: () => void;
};

export function SafeExitDialog({
  open,
  activeCount,
  preparing,
  onKeepRunning,
  onPauseAndExit,
}: SafeExitDialogProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="safe-exit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="safe-exit-title"
      >
        <header>
          <span><ShieldCheck size={23} weight="fill" /></span>
          <button
            type="button"
            aria-label="Keep Forever running"
            onClick={onKeepRunning}
            disabled={preparing}
          >
            <X size={17} />
          </button>
        </header>
        <div>
          <small>Safe Passage</small>
          <h2 id="safe-exit-title">Downloads are still moving.</h2>
          <p>
            {activeCount} active {activeCount === 1 ? "file is" : "files are"} writing to disk.
            Forever can secure their partial progress before closing.
          </p>
          <ul>
            <li>Stop download workers cooperatively</li>
            <li>Flush partial files and save their exact size</li>
            <li>Resume the queue automatically next time</li>
          </ul>
        </div>
        <footer>
          <button
            type="button"
            className="modal-secondary"
            onClick={onKeepRunning}
            disabled={preparing}
          >
            Keep running
          </button>
          <button
            type="button"
            className="modal-primary"
            onClick={onPauseAndExit}
            disabled={preparing}
          >
            <Pause size={17} weight="fill" />
            {preparing ? "Securing downloads…" : "Pause safely & exit"}
          </button>
        </footer>
      </section>
    </div>
  );
}
