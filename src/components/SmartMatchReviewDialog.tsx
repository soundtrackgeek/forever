import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  FileText,
  FolderOpen,
  Gauge,
  MusicNotes,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { FolderInspection, WantedAlbum } from "../types";
import { formatAlbumBytes } from "../utils/albumSources";
import { wantedPreferencesLabel } from "../utils/smartMatches";

type SmartMatchReviewDialogProps = {
  album: WantedAlbum;
  inspection: FolderInspection | null;
  loading: boolean;
  error: string | null;
  queued: boolean;
  onConfirm: () => Promise<unknown>;
  onRetry: () => void;
  onCompare: () => void;
  onClose: () => void;
};

const AUDIO_EXTENSIONS = new Set([
  "aac", "aiff", "alac", "ape", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma", "wv",
]);

const speed = (value: number) => value > 0 ? `${formatAlbumBytes(value)}/s` : "Unknown speed";

export function SmartMatchReviewDialog({
  album,
  inspection,
  loading,
  error,
  queued,
  onConfirm,
  onRetry,
  onCompare,
  onClose,
}: SmartMatchReviewDialogProps) {
  const [queueing, setQueueing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const source = album.bestSource;
  const audioCount = inspection?.files.filter((file) => AUDIO_EXTENSIONS.has(file.extension.toLowerCase())).length ?? source?.trackCount ?? 0;
  const companionCount = inspection ? inspection.files.length - audioCount : 0;
  const inspectedSize = inspection?.files.reduce((total, file) => total + file.sizeBytes, 0) ?? source?.sizeBytes ?? 0;

  const queueAlbum = async () => {
    setQueueing(true);
    setQueueError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setQueueError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setQueueing(false);
    }
  };

  return (
    <div className="smart-match-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="smart-review-dialog" role="dialog" aria-modal="true" aria-labelledby="smart-review-title">
        <header>
          <span className="smart-dialog-mark is-match"><Gauge size={23} weight="light" /></span>
          <span>
            <small>Recommended source</small>
            <h2 id="smart-review-title">Review the best transmission.</h2>
            <p>{album.artist} · {album.title}</p>
          </span>
          <button type="button" aria-label="Close Smart Match review" onClick={onClose}><X size={17} /></button>
        </header>

        {source ? (
          <div className="smart-review-source">
            <span><small>User</small><strong>{source.username}</strong><p>{source.slotFree ? "Free upload slot" : `${source.queueLength} people queued`}</p></span>
            <span><small>Format</small><strong>{source.format}</strong><p>{source.minimumBitrateKbps ? `${source.minimumBitrateKbps}+ kbps` : "Lossless signal"}</p></span>
            <span><small>Release</small><strong>{source.trackCount} tracks</strong><p>{formatAlbumBytes(source.sizeBytes)} reported</p></span>
            <span><small>Source speed</small><strong>{speed(source.averageSpeedBytesPerSecond)}</strong><p>Ranked against your profile</p></span>
          </div>
        ) : null}

        <div className="smart-review-folder">
          <FolderOpen size={19} />
          <span><small>Remote folder</small><strong>{source?.folder ?? "Source folder unavailable"}</strong></span>
        </div>

        <div className={`smart-inspection ${loading ? "is-loading" : error ? "is-error" : "is-ready"}`}>
          {loading ? (
            <><CircleNotch className="search-spinner" size={21} /><span><strong>Verifying the folder</strong><small>Checking the live track and companion-file listing.</small></span></>
          ) : error ? (
            <><WarningCircle size={21} weight="fill" /><span><strong>The folder did not answer.</strong><small>{error}</small></span><button type="button" onClick={onRetry}>Try again</button></>
          ) : inspection ? (
            <>
              <CheckCircle size={21} weight="fill" />
              <span><strong>Folder verified</strong><small>{formatAlbumBytes(inspectedSize)} will be queued from this source.</small></span>
              <dl>
                <div><dt><MusicNotes size={14} /> Audio</dt><dd>{audioCount}</dd></div>
                <div><dt><FileText size={14} /> Companion</dt><dd>{companionCount}</dd></div>
              </dl>
            </>
          ) : null}
        </div>

        <div className="smart-review-policy">
          <small>Your match profile</small>
          <strong>{wantedPreferencesLabel(album.preferences)}</strong>
          <p>Artwork, cue sheets, logs, lyrics, and other files in this album folder are preserved with the audio.</p>
        </div>

        {queueError ? <p className="smart-dialog-error" role="alert">{queueError}</p> : null}
        <footer>
          <button type="button" className="smart-compare-action" onClick={onCompare}>Compare alternatives <ArrowRight size={14} /></button>
          <button
            type="button"
            className={`primary-action ${queued ? "is-queued" : ""}`}
            disabled={!inspection || loading || Boolean(error) || queued || queueing}
            onClick={() => void queueAlbum()}
          >
            {queued
              ? <><CheckCircle size={16} weight="fill" /> Queued</>
              : queueing
                ? <><CircleNotch className="search-spinner" size={16} /> Queueing…</>
                : <><DownloadSimple size={16} weight="bold" /> Queue complete album</>}
          </button>
        </footer>
      </section>
    </div>
  );
}
