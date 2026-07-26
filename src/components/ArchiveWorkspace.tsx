import {
  Archive,
  ArrowsClockwise,
  BellRinging,
  CheckCircle,
  CircleNotch,
  Database,
  Disc,
  Eye,
  LockKey,
  MusicNotes,
  Pause,
  Play,
  Record,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { ArchiveStatus, WantedAlbum, WantedSnapshot } from "../types";
import { formatAlbumBytes } from "../utils/albumSources";

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
  onDismissWantedError: () => void;
};

type ArchiveTab = "library" | "wanted";
type WantedFilter = "all" | "available" | "waiting";

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
  onDismissWantedError,
}: ArchiveWorkspaceProps) {
  const [tab, setTab] = useState<ArchiveTab>("library");
  const [filter, setFilter] = useState<WantedFilter>("all");
  const connected = Boolean(status?.connected);
  const availableCount = wanted.albums.filter((album) => album.sourceCount > 0).length;
  const waitingCount = wanted.albums.filter((album) => album.sourceCount === 0).length;
  const visibleWanted = useMemo(
    () => wanted.albums.filter((album) => {
      if (filter === "available") return album.sourceCount > 0;
      if (filter === "waiting") return album.sourceCount === 0;
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
        ) : (
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
        )}
      </header>

      <div className="archive-tabs" role="tablist" aria-label="Archive views">
        <button type="button" role="tab" aria-selected={tab === "library"} className={tab === "library" ? "is-active" : ""} onClick={() => setTab("library")}>
          <Database size={15} /> Library source
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
      ) : (
        <div className="wanted-workspace">
          <section className="wanted-summary" aria-label="Wanted status">
            <span><small>Listening for</small><strong>{wanted.albums.length}</strong><p>wanted albums</p></span>
            <span className="is-available"><small>Transmitting</small><strong>{availableCount}</strong><p>available now</p></span>
            <span><small>Still quiet</small><strong>{waitingCount}</strong><p>without sources</p></span>
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
              {(["all", "available", "waiting"] as WantedFilter[]).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>
                  {value === "all" ? "All" : value === "available" ? "Available" : "Waiting"}
                  <small>{value === "all" ? wanted.albums.length : value === "available" ? availableCount : waitingCount}</small>
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
              const available = album.sourceCount > 0;
              return (
                <article className={`wanted-row ${available ? "is-available" : "is-waiting"} ${album.paused ? "is-paused" : ""}`} key={album.albumId}>
                  <WantedArtwork album={album} />
                  <span className="wanted-identity">
                    <small>{album.firstReleaseDate.slice(0, 4) || "Year unknown"} · {album.artist}</small>
                    <strong>{album.title}</strong>
                    <p>{relativeCheck(album.lastCheckedAtMs)}{album.paused ? " · Watch paused" : ""}</p>
                  </span>
                  <span className="wanted-availability">
                    <small>{checking ? "Listening now" : available ? "Sources found" : "Signal state"}</small>
                    <strong>{checking ? <><CircleNotch className="search-spinner" size={14} /> Checking</> : available ? `${album.sourceCount} available` : "Still quiet"}</strong>
                    <p>{available ? `${album.readySourceCount} ready now · ${album.completeSourceCount} fullest` : album.error ?? "No matching folders returned"}</p>
                  </span>
                  <span className="wanted-quality">
                    <small>Best signal</small>
                    <strong>{album.bestFormat ?? "—"}</strong>
                    <p>{album.bestTrackCount ? `${album.bestTrackCount} tracks · ${album.bestSizeBytes ? formatAlbumBytes(album.bestSizeBytes) : "size unknown"}` : "Waiting for details"}</p>
                  </span>
                  <span className="wanted-speed">
                    <small>Fastest source</small>
                    <strong>{speed(album.bestSpeedBytesPerSecond)}</strong>
                    {album.newSourceCount > 0 ? <b>+{album.newSourceCount} new</b> : null}
                  </span>
                  <span className="wanted-actions">
                    {available ? <button type="button" className="wanted-open" disabled={!online} onClick={() => onOpenWanted(album)} title={online ? "Run a fresh search and compare album sources" : "Reconnect before comparing sources"}><Eye size={16} /> Compare</button> : null}
                    <button type="button" disabled={!online || checking || Boolean(wanted.activeAlbumId) || album.paused} onClick={() => void onCheckWanted(album.albumId).catch(() => undefined)} title={!online ? "Reconnect before checking" : "Check this album now"}><ArrowsClockwise size={15} /> Check</button>
                    <button type="button" onClick={() => void onSetWantedPaused(album.albumId, !album.paused).catch(() => undefined)} title={album.paused ? "Resume automatic checks" : "Pause automatic checks"}>{album.paused ? <Play size={15} /> : <Pause size={15} />}</button>
                    <button type="button" className="wanted-remove" onClick={() => void onRemoveWanted(album.albumId).catch(() => undefined)} title="Remove from Wanted"><Trash size={15} /></button>
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
