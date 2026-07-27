import {
  Archive,
  ArrowsClockwise,
  BellRinging,
  CheckCircle,
  CircleNotch,
  Database,
  Disc,
  DownloadSimple,
  Eye,
  Gauge,
  LockKey,
  MusicNotes,
  Pause,
  Play,
  Record,
  SlidersHorizontal,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { type ReactNode, useMemo, useState } from "react";
import type { ArchiveStatus, WantedAlbum, WantedSnapshot } from "../types";
import { formatAlbumBytes } from "../utils/albumSources";
import { wantedPreferencesLabel } from "../utils/smartMatches";
import { albumDownloadLabel, type AlbumDownloadState } from "../utils/albumDownloadState";

type ArchiveWorkspaceProps = {
  status: ArchiveStatus | null;
  loading: boolean;
  error: string | null;
  wanted: WantedSnapshot;
  wantedReady: boolean;
  wantedError: string | null;
  online: boolean;
  onRefresh: () => Promise<ArchiveStatus>;
  onSetWantedInterval: (minutes: 0 | 15 | 30 | 60) => Promise<unknown>;
  onCheckWanted: (albumId: string) => Promise<unknown>;
  onSetWantedPaused: (albumId: string, paused: boolean) => Promise<unknown>;
  onRemoveWanted: (albumId: string) => Promise<unknown>;
  onOpenWanted: (album: WantedAlbum) => void;
  onReviewBest: (album: WantedAlbum) => void;
  onEditPreferences: (album: WantedAlbum) => void;
  downloadStateByAlbumId: ReadonlyMap<string, AlbumDownloadState>;
  onOpenTransfer: (groupId: string) => void;
  onDismissWantedError: () => void;
  missingShelf: ReactNode;
  onOpenMissing: () => void;
};

type ArchiveTab = "library" | "missing" | "wanted";
type WantedFilter = "all" | "matches" | "waiting" | "fulfilled";

const count = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString();

const date = (value: string | null | undefined) => {
  if (!value) return "Not reported";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
};

const relativeCheck = (value: number | null) => {
  if (!value) return "Never checked";
  const elapsed = Math.max(0, Date.now() - value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  return `Checked ${Math.floor(hours / 24)}d ago`;
};

const speed = (value: number | null) =>
  value ? `${formatAlbumBytes(value)}/s` : "Speed unknown";

function WantedArtwork({ album }: { album: WantedAlbum }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="wanted-artwork">
      {!failed && album.coverArtUrl ? (
        <img src={album.coverArtUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Record size={27} weight="thin" />
      )}
    </span>
  );
}

function WantedDownloadIcon({ state }: { state: AlbumDownloadState }) {
  if (state.status === "downloading") return <CircleNotch className="search-spinner" size={16} />;
  if (state.status === "paused") return <Pause size={16} weight="fill" />;
  if (state.status === "failed") return <WarningCircle size={16} weight="fill" />;
  if (state.status === "downloaded") return <CheckCircle size={16} weight="fill" />;
  return <DownloadSimple size={16} weight="bold" />;
}

export function ArchiveWorkspace({
  status,
  loading,
  error,
  wanted,
  wantedReady,
  wantedError,
  online,
  onRefresh,
  onSetWantedInterval,
  onCheckWanted,
  onSetWantedPaused,
  onRemoveWanted,
  onOpenWanted,
  onReviewBest,
  onEditPreferences,
  downloadStateByAlbumId,
  onOpenTransfer,
  onDismissWantedError,
  missingShelf,
  onOpenMissing,
}: ArchiveWorkspaceProps) {
  const [tab, setTab] = useState<ArchiveTab>("library");
  const [filter, setFilter] = useState<WantedFilter>("all");
  const connected = Boolean(status?.connected);
  const availableCount = wanted.albums.filter((album) => !album.fulfilled && album.matchingSourceCount > 0).length;
  const waitingCount = wanted.albums.filter((album) => !album.fulfilled && album.matchingSourceCount === 0).length;
  const fulfilledCount = wanted.albums.filter((album) => album.fulfilled).length;
  const visibleWanted = useMemo(
    () => wanted.albums.filter((album) => {
      if (filter === "matches") return !album.fulfilled && album.matchingSourceCount > 0;
      if (filter === "waiting") return !album.fulfilled && album.matchingSourceCount === 0;
      if (filter === "fulfilled") return album.fulfilled;
      return true;
    }),
    [filter, wanted.albums],
  );

  return (
    <section className="archive-workspace" aria-label="Archive">
      <header className="archive-heading">
        <div>
          <span className="archive-heading-mark"><Archive size={21} weight="light" /></span>
          <span>
            <h1>Your collection, without touching it.</h1>
            <p>Music Library remains the source of truth. Wanted listens for everything still missing.</p>
          </span>
        </div>
        {tab === "library" ? (
          <button
            type="button"
            className="archive-refresh"
            disabled={loading}
            onClick={() => void onRefresh().catch(() => undefined)}
          >
            <ArrowsClockwise className={loading ? "is-spinning" : ""} size={16} />
            {loading ? "Checking…" : "Refresh Archive"}
          </button>
        ) : tab === "wanted" ? (
          <label className="wanted-interval">
            <span>Check rhythm</span>
            <select
              value={wanted.intervalMinutes}
              onChange={(event) => void onSetWantedInterval(Number(event.target.value) as 0 | 15 | 30 | 60).catch(() => undefined)}
            >
              <option value={0}>Manual only</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
            </select>
          </label>
        ) : (
          <span className="missing-readonly-note"><LockKey size={14} /> Selective · cached · read-only</span>
        )}
      </header>

      <div className="archive-tabs" role="tablist" aria-label="Archive views">
        <button type="button" role="tab" aria-selected={tab === "library"} className={tab === "library" ? "is-active" : ""} onClick={() => setTab("library")}>
          <Database size={15} /> Library source
        </button>
        <button type="button" role="tab" aria-selected={tab === "missing"} className={tab === "missing" ? "is-active" : ""} onClick={() => { setTab("missing"); onOpenMissing(); }}>
          <Record size={15} /> Missing shelf
        </button>
        <button type="button" role="tab" aria-selected={tab === "wanted"} className={tab === "wanted" ? "is-active" : ""} onClick={() => setTab("wanted")}>
          <BellRinging size={15} /> Wanted <small>{wanted.albums.length}</small>
        </button>
      </div>

      {tab === "library" ? (
        <>
          <article className={`archive-source ${connected ? "is-connected" : "is-disconnected"}`}>
            <div className="archive-source-intro">
              <span className="archive-database-mark"><Database size={29} weight="thin" /></span>
              <span>
                <small>Music Library database</small>
                <h2>{connected ? "Archive connected" : "Archive unavailable"}</h2>
                <p>{status?.path ?? "Resolving the Music Library database…"}</p>
              </span>
              <strong><i aria-hidden="true" />{connected ? "Live source" : "Needs attention"}</strong>
            </div>
            {error ? (
              <div className="archive-source-error" role="alert">
                <WarningCircle size={17} weight="fill" />
                <span><strong>Forever could not read the Archive.</strong>{error}</span>
              </div>
            ) : null}
            <dl className="archive-stats">
              <div><dt><Disc size={15} /> Albums</dt><dd>{count(status?.albumCount)}</dd></div>
              <div><dt><MusicNotes size={15} /> Tracks</dt><dd>{count(status?.trackCount)}</dd></div>
              <div><dt><ArrowsClockwise size={15} /> Latest import</dt><dd>{date(status?.lastImportedAt)}</dd></div>
            </dl>
          </article>

          <div className="archive-principles">
            <article>
              <LockKey size={22} weight="light" />
              <span><h2>Read-only by construction</h2><p>The database is opened with SQLite’s read-only flag and query-only mode. Forever has no Archive write commands.</p></span>
              <strong>Protected</strong>
            </article>
            <article>
              <CheckCircle size={22} weight="light" />
              <span><h2>Ownership follows your real library</h2><p>Album discovery is checked against normalized albums, while Wanted is stored separately by Forever.</p></span>
            </article>
            <article>
              <Archive size={22} weight="light" />
              <span><h2>Forever downloads remain separate</h2><p>A completed download stays watched until Music Library reports it as owned or you remove it yourself.</p></span>
            </article>
          </div>
        </>
      ) : tab === "missing" ? (
        missingShelf
      ) : (
        <div className="wanted-workspace">
          <section className="wanted-summary" aria-label="Wanted status">
            <span><small>Listening for</small><strong>{wanted.albums.length}</strong><p>wanted albums</p></span>
            <span className="is-available"><small>Smart Matches</small><strong>{availableCount}</strong><p>ready to review</p></span>
            <span><small>Still quiet</small><strong>{waitingCount}</strong><p>without a match</p></span>
            <span className="is-fulfilled"><small>In your Archive</small><strong>{fulfilledCount}</strong><p>fulfilled automatically</p></span>
            <span className={online ? "is-online" : "is-offline"}><small>Background checks</small><strong>{online ? wanted.intervalMinutes ? "Live" : "Manual" : "Paused"}</strong><p>{online ? wanted.activeAlbumId ? "checking one album" : "network online" : "resume when reconnected"}</p></span>
          </section>

          {wantedError ? (
            <div className="wanted-error" role="alert">
              <WarningCircle size={17} weight="fill" />
              <span><strong>Wanted missed a beat.</strong>{wantedError}</span>
              <button type="button" onClick={onDismissWantedError}>Dismiss</button>
            </div>
          ) : null}

          <div className="wanted-toolbar">
            <div role="tablist" aria-label="Filter wanted albums">
              {(["all", "matches", "waiting", "fulfilled"] as WantedFilter[]).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>
                  {value === "all" ? "All" : value === "matches" ? "Matches" : value === "fulfilled" ? "Fulfilled" : "Waiting"}
                  <small>{value === "all" ? wanted.albums.length : value === "matches" ? availableCount : value === "fulfilled" ? fulfilledCount : waitingCount}</small>
                </button>
              ))}
            </div>
            <p>{wanted.intervalMinutes ? `Checks run every ${wanted.intervalMinutes === 60 ? "hour" : `${wanted.intervalMinutes} minutes`} while connected.` : "Automatic checks are off."}</p>
          </div>

          <div className="wanted-list" aria-live="polite">
            {!wantedReady ? (
              <div className="wanted-empty"><CircleNotch className="search-spinner" size={27} /><strong>Opening Wanted</strong><p>Reading Forever’s separate watchlist.</p></div>
            ) : visibleWanted.length === 0 ? (
              <div className="wanted-empty"><BellRinging size={30} weight="thin" /><strong>{wanted.albums.length ? "Nothing in this filter" : "Nothing wanted yet"}</strong><p>{wanted.albums.length ? "Choose another filter above." : "Use Add to Wanted from MusicBrainz album discovery."}</p></div>
            ) : visibleWanted.map((album) => {
              const checking = wanted.activeAlbumId === album.albumId;
              const available = album.matchingSourceCount > 0 && Boolean(album.bestSource);
              const downloadState = downloadStateByAlbumId.get(album.albumId);
              const downloadLabel = downloadState ? albumDownloadLabel(downloadState) : "Download best";
              return (
                <article className={`wanted-row ${album.fulfilled ? "is-fulfilled" : available ? "is-available" : "is-waiting"} ${album.paused ? "is-paused" : ""}`} key={album.albumId}>
                  <WantedArtwork album={album} />
                  <span className="wanted-identity">
                    <small>{album.firstReleaseDate.slice(0, 4) || "Year unknown"} · {album.artist}</small>
                    <strong>{album.title}</strong>
                    <p>{album.fulfilled ? "Fulfilled by Music Library" : relativeCheck(album.lastCheckedAtMs)}{album.paused && !album.fulfilled ? " · Watch paused" : ""}</p>
                    {!album.fulfilled ? <em><Gauge size={12} /> {wantedPreferencesLabel(album.preferences)}</em> : null}
                  </span>
                  <span className="wanted-availability">
                    <small>{album.fulfilled ? "Archive state" : checking ? "Listening now" : available ? "Smart Match" : "Signal state"}</small>
                    <strong>{album.fulfilled ? <><CheckCircle size={14} weight="fill" /> Owned</> : checking ? <><CircleNotch className="search-spinner" size={14} /> Checking</> : available ? `${album.matchingSourceCount} matching` : "Still quiet"}</strong>
                    <p>{album.fulfilled ? `${album.ownedTrackCount ?? "—"} tracks in your library` : available ? `${album.sourceCount} total · ${album.readySourceCount} ready now` : album.sourceCount ? `${album.sourceCount} sources miss your profile` : album.error ?? "No matching folders returned"}</p>
                  </span>
                  <span className="wanted-quality">
                    <small>{album.fulfilled ? "Ownership" : "Best match"}</small>
                    <strong>{album.fulfilled ? "Archive" : album.bestFormat ?? "—"}</strong>
                    <p>{album.fulfilled ? "Read-only source of truth" : album.bestTrackCount ? `${album.bestTrackCount} tracks · ${album.bestSizeBytes ? formatAlbumBytes(album.bestSizeBytes) : "size unknown"}` : "Waiting for a qualifying source"}</p>
                  </span>
                  <span className="wanted-speed">
                    <small>{album.fulfilled ? "Watch state" : "Recommended source"}</small>
                    <strong>{album.fulfilled ? "Complete" : album.bestSource?.slotFree ? "Free slot" : album.bestSource ? `${album.bestSource.queueLength} queued` : speed(album.bestSpeedBytesPerSecond)}</strong>
                    {!album.fulfilled && album.bestSource ? <p>{speed(album.bestSource.averageSpeedBytesPerSecond)}</p> : null}
                    {!album.fulfilled && album.newSourceCount > 0 ? <b>+{album.newSourceCount} new match{album.newSourceCount === 1 ? "" : "es"}</b> : null}
                  </span>
                  <span className="wanted-actions">
                    {available && !album.fulfilled ? <button type="button" className={`wanted-download-best${downloadState ? ` is-${downloadState.status}` : ""}`} disabled={!online && !downloadState} onClick={() => downloadState ? onOpenTransfer(downloadState.groupId) : onReviewBest(album)} title={downloadState ? `${downloadLabel}. Open this album in Transfers.` : online ? "Review and queue Forever's recommended source" : "Reconnect before downloading"}>{downloadState ? <WantedDownloadIcon state={downloadState} /> : <DownloadSimple size={16} weight="bold" />} {downloadLabel}</button> : null}
                    {!album.fulfilled && album.sourceCount > 0 ? <button type="button" className="wanted-open" disabled={!online} onClick={() => onOpenWanted(album)} title={online ? "Run a fresh search and compare album sources" : "Reconnect before comparing sources"}><Eye size={16} /> Compare</button> : null}
                    {!album.fulfilled ? <button type="button" aria-label={`Edit ${album.title} Smart Match profile`} onClick={() => onEditPreferences(album)} title="Edit Smart Match profile"><SlidersHorizontal size={15} /></button> : null}
                    {!album.fulfilled ? <button type="button" aria-label={`Check ${album.title} now`} disabled={!online || checking || Boolean(wanted.activeAlbumId) || album.paused} onClick={() => void onCheckWanted(album.albumId).catch(() => undefined)} title={!online ? "Reconnect before checking" : "Check this album now"}><ArrowsClockwise size={15} /></button> : null}
                    {!album.fulfilled ? <button type="button" aria-label={`${album.paused ? "Resume" : "Pause"} ${album.title} watch`} onClick={() => void onSetWantedPaused(album.albumId, !album.paused).catch(() => undefined)} title={album.paused ? "Resume automatic checks" : "Pause automatic checks"}>{album.paused ? <Play size={15} /> : <Pause size={15} />}</button> : null}
                    <button type="button" className="wanted-remove" aria-label={`Remove ${album.title} from Wanted`} onClick={() => void onRemoveWanted(album.albumId).catch(() => undefined)} title="Remove from Wanted"><Trash size={15} /></button>
                  </span>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
