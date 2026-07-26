import { ArrowRight, BellRinging, Gauge, X } from "@phosphor-icons/react";
import type { WantedAlbum } from "../types";

type WantedAlertProps = {
  album: WantedAlbum;
  onReview: () => void;
  onCompare: () => void;
  onDismiss: () => void;
};

export function WantedAlert({ album, onReview, onCompare, onDismiss }: WantedAlertProps) {
  return (
    <aside className="wanted-alert" aria-live="polite">
      <span className="wanted-alert-mark"><BellRinging size={20} weight="fill" /></span>
      <span>
        <small>Smart Match found</small>
        <strong>{album.title}</strong>
        <p>{album.bestSource ? `${album.bestSource.format} · ${album.bestSource.trackCount} tracks · ${album.bestSource.slotFree ? "free slot" : `${album.bestSource.queueLength} queued`}` : `${album.matchingSourceCount} matching sources`} for {album.artist}.</p>
      </span>
      <button type="button" className="wanted-alert-open" onClick={onReview} disabled={!album.bestSource}>
        Review match <Gauge size={14} />
      </button>
      <button type="button" className="wanted-alert-compare" onClick={onCompare}>
        Compare <ArrowRight size={14} />
      </button>
      <button type="button" className="wanted-alert-close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={14} />
      </button>
    </aside>
  );
}
