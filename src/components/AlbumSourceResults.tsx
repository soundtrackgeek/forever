import {
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  Eye,
  FolderOpen,
  Pause,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useId, useMemo, useState, type FocusEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { AlbumSource, PersonProfile, Transfer, WantedPreferences } from "../types";
import {
  albumDownloadLabel,
  albumDownloadStates,
  type AlbumDownloadStatus,
} from "../utils/albumDownloadState";
import { formatAlbumBytes } from "../utils/albumSources";
import { rankAlbumSources } from "../utils/smartMatches";
import { CountryFlag } from "./CountryFlag";

type AlbumSourceResultsProps = {
  sources: AlbumSource[];
  transfers: Transfer[];
  searching: boolean;
  onQueueAlbumSource: (source: AlbumSource) => Promise<void>;
  onBrowseUser: (username: string) => void;
  personByUsername: (username: string) => PersonProfile | null;
  onOpenPerson: (username: string) => void;
  smartPreferences?: WantedPreferences;
};

function DownloadStateIcon({ state }: { state: AlbumDownloadStatus }) {
  if (state === "downloading") {
    return <CircleNotch className="search-spinner" size={16} />;
  }
  if (state === "downloaded") return <CheckCircle size={16} weight="fill" />;
  if (state === "paused") return <Pause size={16} weight="fill" />;
  if (state === "failed") return <WarningCircle size={16} weight="fill" />;
  return <DownloadSimple size={16} weight="bold" />;
}

const filename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? path;

const duration = (seconds: number | null | undefined) => {
  if (!seconds) return null;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const speed = (bytesPerSecond: number) =>
  bytesPerSecond > 0 ? `${formatAlbumBytes(bytesPerSecond)}/s` : "Speed unknown";

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

function TrackPreview({ source }: { source: AlbumSource }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 360 });
  const visibleTracks = source.tracks.slice(0, 16);

  const show = (
    event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.min(380, Math.max(280, window.innerWidth - 24));
    const estimatedHeight = Math.min(source.tracks.length, 16) * 27 + 78;
    const left = Math.max(
      12,
      Math.min(bounds.right - width, window.innerWidth - width - 12),
    );
    const below = bounds.bottom + 8;
    const top =
      below + estimatedHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, bounds.top - estimatedHeight - 8);
    setPosition({ left, top, width });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className="album-preview-trigger"
        aria-label={`Preview tracks in ${source.folderName} from ${source.owner}`}
        aria-describedby={open ? tooltipId : undefined}
        title="Preview track list"
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        <Eye size={17} />
      </button>
      {open
        ? createPortal(
            <aside
              id={tooltipId}
              className="album-track-popover"
              role="tooltip"
              style={position}
            >
              <header>
                <span>
                  <strong>{source.folderName}</strong>
                  <small>{source.owner} · track preview</small>
                </span>
                <b>{source.tracks.length}</b>
              </header>
              {visibleTracks.length ? (
                <ol>
                  {visibleTracks.map((track) => (
                    <li key={track.id}>
                      <span>{filename(track.filename ?? track.title)}</span>
                      <small>
                        {[duration(track.durationSeconds), track.format]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No audio tracks were returned for this folder.</p>
              )}
              {source.tracks.length > visibleTracks.length ? (
                <footer>+ {source.tracks.length - visibleTracks.length} more tracks</footer>
              ) : null}
            </aside>,
            document.body,
          )
        : null}
    </>
  );
}

export function AlbumSourceResults({
  sources,
  transfers,
  searching,
  onQueueAlbumSource,
  onBrowseUser,
  personByUsername,
  onOpenPerson,
  smartPreferences,
}: AlbumSourceResultsProps) {
  const [preparingSourceId, setPreparingSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceDownloadStates = useMemo(
    () => albumDownloadStates(sources, transfers),
    [sources, transfers],
  );
  const rankedSources = useMemo(
    () => smartPreferences ? rankAlbumSources(sources, smartPreferences) : [],
    [smartPreferences, sources],
  );
  const rankBySourceId = useMemo(
    () => new Map(rankedSources.map((match) => [match.source.id, match])),
    [rankedSources],
  );
  const recommendedSourceId = rankedSources.find((match) => match.eligible)?.source.id;

  const queueAlbum = async (source: AlbumSource) => {
    setPreparingSourceId(source.id);
    setError(null);
    try {
      await onQueueAlbumSource(source);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPreparingSourceId(null);
    }
  };

  return (
    <div className="album-source-results">
      {error ? (
        <div className="album-source-error" role="alert">
          <span><strong>Could not prepare that album.</strong>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      ) : null}
      <div className="album-source-table">
        <div className="album-source-header" aria-hidden="true">
          <span>User</span>
          <span>Folder</span>
          <span>Tracks</span>
          <span>Format</span>
          <span>Album size</span>
          <span>Availability</span>
          <span />
        </div>
        <div className="album-source-list" aria-live="polite">
          {sources.length === 0 ? (
            <div className="empty-results">
              {searching ? (
                <CircleNotch className="search-spinner" size={28} />
              ) : (
                <FolderOpen size={28} weight="light" />
              )}
              <h3>{searching ? "Listening for album folders" : "No album folders found"}</h3>
              <p>
                {searching
                  ? "Sources will group here as people respond."
                  : "Try the individual file view or search for a broader release title."}
              </p>
            </div>
          ) : (
            sources.map((source) => {
              const smartMatch = rankBySourceId.get(source.id);
              const recommended = source.id === recommendedSourceId;
              const person = personByUsername(source.owner);
              const preparing = preparingSourceId === source.id;
              const queuedState = sourceDownloadStates.get(source.id);
              const downloadable = Boolean(source.representative.folder);
              const buttonLabel = queuedState
                ? albumDownloadLabel(queuedState)
                : preparing
                  ? "Preparing…"
                  : "Download album";
              return (
                <article className={`album-source-row ${recommended ? "is-smart-match" : ""}`} key={source.id}>
                  <button
                    type="button"
                    className="album-source-user"
                    onClick={() => onOpenPerson(source.owner)}
                    aria-label={`View ${source.owner}'s profile`}
                  >
                    <CountryFlag code={person?.countryCode} />
                    <span><strong>{source.owner}</strong><small>{source.isPrivate ? "Private share" : "Public share"}</small></span>
                  </button>
                  <span className="album-source-folder">
                    {recommended ? <b className="album-smart-match">Smart Match</b> : null}
                    <strong>{source.folderName}</strong>
                    <small title={source.folder}>{source.folder.replace(/[\\/]/g, " / ")}</small>
                  </span>
                  <span className="album-source-tracks">
                    <strong>{source.tracks.length}</strong>
                    <small>{source.tracks.length === 1 ? "track" : "tracks"}</small>
                  </span>
                  <span className="album-source-formats">
                    {source.formats.slice(0, 3).map((format) => <b key={format}>{format}</b>)}
                    <small>{source.qualities.slice(0, 1).join("") || "Details unknown"}</small>
                  </span>
                  <span className="album-source-size">
                    <strong>{formatAlbumBytes(source.totalSizeBytes)}</strong>
                    <small>search total</small>
                  </span>
                  <span className={`album-source-availability ${source.slotFree ? "is-ready" : "is-queued"}`}>
                    <strong><i aria-hidden="true" />{source.slotFree ? "Ready now" : `${source.queueLength} queued`}</strong>
                    <small>{smartMatch?.reason ?? speed(source.averageSpeed)}</small>
                  </span>
                  <span className="album-source-actions">
                    <TrackPreview source={source} />
                    <button
                      type="button"
                      className="album-source-browse"
                      aria-label={`Browse files shared by ${source.owner}`}
                      title="Browse user shares"
                      onClick={() => onBrowseUser(source.owner)}
                    >
                      <UserCircle size={17} />
                    </button>
                    <button
                      type="button"
                      className={`album-source-download${queuedState ? ` is-${queuedState.status}` : ""}`}
                      disabled={!downloadable || preparingSourceId !== null || Boolean(queuedState)}
                      title={queuedState ? `${buttonLabel}. Manage this album in Transfers.` : downloadable ? "Inspect the folder and download every file" : "This result has no source folder"}
                      onClick={() => void queueAlbum(source)}
                    >
                      {queuedState ? <DownloadStateIcon state={queuedState.status} /> : preparing ? <CircleNotch className="search-spinner" size={16} /> : <DownloadSimple size={16} weight="bold" />}
                      {buttonLabel}
                    </button>
                  </span>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
