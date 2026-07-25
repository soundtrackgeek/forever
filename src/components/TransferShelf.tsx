import {
  CaretRight,
  DownloadSimple,
  Pause,
  Play,
  X,
} from "@phosphor-icons/react";
import type { Transfer } from "../types";

type TransferShelfProps = {
  transfers: Transfer[];
  onToggleTransfer: (id: string) => void;
  onCancelTransfer: (id: string) => void;
};

export function TransferShelf({
  transfers,
  onToggleTransfer,
  onCancelTransfer,
}: TransferShelfProps) {
  return (
    <section className="transfer-shelf" aria-label="Transfer activity">
      <div className="transfer-summary">
        <img src="/assets/night-geometry-cover.png" alt="" />
        <span>
          <strong>Transfers</strong>
          <small>
            <DownloadSimple size={14} weight="bold" />
            {transfers.filter((transfer) => transfer.status === "downloading").length}{" "}
            active
          </small>
        </span>
      </div>

      <div className="transfer-list">
        <header>
          <span>
            Transfer queue <b>{transfers.length}</b>
          </span>
          <button type="button">
            View all transfers <CaretRight size={12} weight="bold" />
          </button>
        </header>

        {transfers.length === 0 ? (
          <div className="transfer-empty">Your transfer queue is clear.</div>
        ) : (
          transfers.slice(0, 3).map((transfer) => (
            <article className="transfer-row" key={transfer.id}>
              <span className="transfer-name">
                <strong>{transfer.release}</strong>
                <small>{transfer.track}</small>
              </span>
              <span className="transfer-progress">
                <i>
                  <b style={{ width: `${transfer.progress}%` }} />
                </i>
                <small>
                  {transfer.transferred} / {transfer.total}
                </small>
              </span>
              <span className="transfer-meta">
                {transfer.status === "paused" ? "Paused" : transfer.speed}
                <small>{transfer.eta}</small>
              </span>
              <button
                type="button"
                aria-label={
                  transfer.status === "paused"
                    ? `Resume ${transfer.track}`
                    : `Pause ${transfer.track}`
                }
                onClick={() => onToggleTransfer(transfer.id)}
              >
                {transfer.status === "paused" ? (
                  <Play size={14} weight="fill" />
                ) : (
                  <Pause size={14} weight="fill" />
                )}
              </button>
              <button
                type="button"
                aria-label={`Cancel ${transfer.track}`}
                onClick={() => onCancelTransfer(transfer.id)}
              >
                <X size={14} weight="bold" />
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
