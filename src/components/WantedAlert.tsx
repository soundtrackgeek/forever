import { ArrowRight, BellRinging, X } from "@phosphor-icons/react";
import type { WantedAlbum } from "../types";

type WantedAlertProps = {
  album: WantedAlbum;
  onOpen: () => void;
  onDismiss: () => void;
};

export function WantedAlert({ album, onOpen, onDismiss }: WantedAlertProps) {
  return (
    <aside className="wanted-alert" aria-live="polite">
      <span className="wanted-alert-mark"><BellRinging size={20} weight="fill" /></span>
      <span>
        <small>Wanted signal found</small>
        <strong>{album.title}</strong>
        <p>{album.sourceCount} {album.sourceCount === 1 ? "source" : "sources"} now transmitting for {album.artist}.</p>
      </span>
      <button type="button" className="wanted-alert-open" onClick={onOpen}>
        Compare sources <ArrowRight size={14} />
      </button>
      <button type="button" className="wanted-alert-close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={14} />
      </button>
    </aside>
  );
}
