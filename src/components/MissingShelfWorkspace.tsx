import {
  Broadcast,
  Check,
  CheckCircle,
  CircleNotch,
  ClockCountdown,
  Database,
  DownloadSimple,
  Eye,
  MagnifyingGlass,
  Pause,
  Plus,
  Record,
  SlidersHorizontal,
  Stop,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type {
  AlbumArtist,
  AlbumCatalog,
  AlbumReleaseGroup,
  AlbumSource,
  ArchiveAlbumMatch,
  ArchiveArtistSummary,
  RadarAlbumScan,
  RadarSnapshot,
  SearchResult,
  Transfer,
  WantedAlbum,
  WantedFormatPreference,
  WantedPreferences,
} from "../types";
import type { MissingShelfLoading } from "../hooks/useMissingShelf";
import { formatAlbumBytes, groupAlbumSources } from "../utils/albumSources";
import {
  albumDownloadLabel,
  albumDownloadStates,
  type AlbumDownloadStatus,
} from "../utils/albumDownloadState";
import { rankAlbumSources } from "../utils/smartMatches";

type MissingShelfWorkspaceProps = {
  query: string;
  artists: ArchiveArtistSummary[];
  artistsTruncated: boolean;
  selectedArtist: ArchiveArtistSummary | null;
  identityOptions: AlbumArtist[];
  catalog: AlbumCatalog | null;
  catalogSource: "archiveCache" | "musicbrainz" | null;
  catalogFetchedAt: string | null;
  loading: MissingShelfLoading;
  error: string | null;
  matchByAlbumId: ReadonlyMap<string, ArchiveAlbumMatch>;
  wantedAlbums: WantedAlbum[];
  defaultPreferences: WantedPreferences;
  online: boolean;
  radarReady: boolean;
  radarSnapshot: RadarSnapshot;
  radarScans: ReadonlyMap<string, RadarAlbumScan>;
  radarResults: ReadonlyMap<string, SearchResult[]>;
  transfers: Transfer[];
  onSearchArtists: (query: string) => Promise<ArchiveArtistSummary[]>;
  onSelectArtist: (artist: ArchiveArtistSummary) => Promise<AlbumCatalog | null>;
  onSelectIdentity: (artist: AlbumArtist) => Promise<AlbumCatalog | null>;
  onAddMany: (
    artist: string,
    albums: AlbumReleaseGroup[],
    preferences: WantedPreferences,
    minimumTrackCounts?: Record<string, number>,
  ) => Promise<unknown>;
  onResolveOfficialTrackCount: (album: AlbumReleaseGroup) => Promise<number | null>;
  onScan: (artist: string, albums: AlbumReleaseGroup[]) => Promise<unknown>;
  onStopScan: () => Promise<unknown>;
  onQueueSource: (
    album: AlbumReleaseGroup,
    source: AlbumSource,
    availableSources: AlbumSource[],
  ) => Promise<void>;
  onOpenTransfer: (groupId: string) => void;
  onDismissError: () => void;
};

type ReleaseFilter = "studio" | "live" | "compilation" | "ep" | "all";
type ShelfState = "owned" | "wanted" | "missing";
type TrackCountMode = "any" | "custom" | "musicbrainz";

const DEFAULT_TRACK_COUNT_FALLBACK = 10;

const trackCountModeFor = (preferences: WantedPreferences): TrackCountMode =>
  preferences.minimumTrackCount === null ? "any" : "custom";

const category = (album: AlbumReleaseGroup): Exclude<ReleaseFilter, "all"> => {
  const secondary = album.secondaryTypes.map((value) => value.toLowerCase());
  if (album.primaryType?.toLowerCase() === "ep") return "ep";
  if (secondary.includes("live")) return "live";
  if (secondary.includes("compilation")) return "compilation";
  return "studio";
};

const year = (album: AlbumReleaseGroup) => {
  const parsed = Number(album.firstReleaseDate.slice(0, 4));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const date = (value: string | null) => {
  if (!value) return "Live lookup needed";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Cached by Music Library"
    : `Cached ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed)}`;
};

function ReleaseArtwork({ album }: { album: AlbumReleaseGroup }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="missing-release-artwork">
      {!failed && album.coverArtUrl ? (
        <img src={album.coverArtUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : <Record size={25} weight="thin" />}
    </span>
  );
}

const filename = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? path;
const speed = (bytesPerSecond: number) => bytesPerSecond > 0 ? `${formatAlbumBytes(bytesPerSecond)}/s` : "Speed unknown";
const losslessFormats = new Set(["FLAC", "ALAC", "APE", "WAV", "AIFF", "WV"]);

function RadarDownloadIcon({ status }: { status: AlbumDownloadStatus }) {
  if (status === "downloading") return <CircleNotch className="search-spinner" size={15} />;
  if (status === "queued") return <ClockCountdown size={15} weight="fill" />;
  if (status === "downloaded") return <CheckCircle size={15} weight="fill" />;
  if (status === "paused") return <Pause size={15} weight="fill" />;
  return <WarningCircle size={15} weight="fill" />;
}

function RadarSourceDrawer({
  album,
  sources,
  transfers,
  preferences,
  watched,
  preparingSourceId,
  onDownload,
  onWatch,
  onRescan,
  onOpenTransfer,
}: {
  album: AlbumReleaseGroup;
  sources: AlbumSource[];
  transfers: Transfer[];
  preferences: WantedPreferences;
  watched: boolean;
  preparingSourceId: string | null;
  onDownload: (source: AlbumSource) => void;
  onWatch: () => void;
  onRescan: () => void;
  onOpenTransfer: (groupId: string) => void;
}) {
  const ranked = rankAlbumSources(sources, preferences);
  const best = ranked.find((source) => source.eligible)?.source ?? sources[0];
  const downloadStates = useMemo(
    () => albumDownloadStates(sources, transfers),
    [sources, transfers],
  );
  const bestState = best ? downloadStates.get(best.id) : undefined;
  const bestPreparing = best ? preparingSourceId === best.id : false;
  const bestLabel = bestState
    ? albumDownloadLabel(bestState)
    : bestPreparing
      ? "Preparing…"
      : "Download best";
  return (
    <section className="shelf-radar-drawer">
      <header>
        <span><Broadcast size={17} /><strong>{sources.length} {sources.length === 1 ? "source" : "sources"} on radar</strong><small>{best ? `Best signal: ${best.formats.join(" + ") || "unknown format"} from ${best.owner}` : "No grouped folders were returned."}</small></span>
        <div>
          <button type="button" className="shelf-radar-rescan" onClick={onRescan}><Broadcast size={14} /> Rescan</button>
          {!watched ? <button type="button" className="shelf-radar-watch" onClick={onWatch}><Plus size={14} weight="bold" /> Watch for better</button> : null}
          {best ? <button type="button" className={`shelf-radar-download${bestState ? ` is-${bestState.status}` : ""}`} disabled={preparingSourceId !== null && !bestState} onClick={() => bestState ? onOpenTransfer(bestState.groupId) : onDownload(best)} title={bestState ? `${bestLabel}. Open this album in Transfers.` : "Download Forever's recommended source"}>{bestState ? <RadarDownloadIcon status={bestState.status} /> : bestPreparing ? <CircleNotch className="search-spinner" size={15} /> : <DownloadSimple size={15} weight="bold" />} {bestLabel}</button> : null}
        </div>
      </header>
      <div className="shelf-radar-sources">
        {sources.slice(0, 5).map((source) => {
          const downloadState = downloadStates.get(source.id);
          const downloadLabel = downloadState ? albumDownloadLabel(downloadState) : null;
          return <article key={source.id}>
            <span><strong>{source.owner}</strong><small>{source.isPrivate ? "Private share" : "Public share"}</small></span>
            <span className="shelf-radar-folder"><strong>{source.folderName}</strong><small title={source.folder}>{source.folder.replace(/[\\/]/g, " / ")}</small></span>
            <span><strong>{source.tracks.length} tracks</strong><small>{source.formats.join(" + ") || "Unknown format"} · {formatAlbumBytes(source.totalSizeBytes)}</small></span>
            <span className={source.slotFree ? "is-ready" : "is-queued"}><strong>{source.slotFree ? "Ready now" : `${source.queueLength} queued`}</strong><small>{speed(source.averageSpeed)}</small></span>
            <details>
              <summary><Eye size={15} /> Tracks</summary>
              <ol>{source.tracks.slice(0, 24).map((track) => <li key={track.id}><span>{filename(track.filename ?? track.title)}</span><small>{track.format}</small></li>)}</ol>
              {source.tracks.length > 24 ? <p>+ {source.tracks.length - 24} more tracks</p> : null}
            </details>
            <button type="button" className={`shelf-radar-source-download${downloadState ? ` is-${downloadState.status}` : ""}`} disabled={preparingSourceId !== null && !downloadState} onClick={() => downloadState ? onOpenTransfer(downloadState.groupId) : onDownload(source)} aria-label={downloadLabel ? `${downloadLabel}: ${album.title} from ${source.owner}` : `Download ${album.title} from ${source.owner}`} title={downloadLabel ? `${downloadLabel}. Open this album in Transfers.` : `Download ${album.title} from ${source.owner}`}>{downloadState ? <RadarDownloadIcon status={downloadState.status} /> : preparingSourceId === source.id ? <CircleNotch className="search-spinner" size={15} /> : <DownloadSimple size={15} />}</button>
          </article>;
        })}
      </div>
    </section>
  );
}

export function MissingShelfWorkspace({
  query,
  artists,
  artistsTruncated,
  selectedArtist,
  identityOptions,
  catalog,
  catalogSource,
  catalogFetchedAt,
  loading,
  error,
  matchByAlbumId,
  wantedAlbums,
  defaultPreferences,
  online,
  radarReady,
  radarSnapshot,
  radarScans,
  radarResults,
  transfers,
  onSearchArtists,
  onSelectArtist,
  onSelectIdentity,
  onAddMany,
  onResolveOfficialTrackCount,
  onScan,
  onStopScan,
  onQueueSource,
  onOpenTransfer,
  onDismissError,
}: MissingShelfWorkspaceProps) {
  const [artistQuery, setArtistQuery] = useState(query);
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("studio");
  const [decade, setDecade] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [trackCountMode, setTrackCountMode] = useState<TrackCountMode>(
    trackCountModeFor(defaultPreferences),
  );
  const [trackCountError, setTrackCountError] = useState<string | null>(null);
  const [trackCountNotice, setTrackCountNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [openRadarAlbumId, setOpenRadarAlbumId] = useState<string | null>(null);
  const [preparingSourceId, setPreparingSourceId] = useState<string | null>(null);
  const wantedIds = useMemo(
    () => new Set(
      wantedAlbums
        .filter((album) => !album.fulfilled)
        .map((album) => album.albumId.toLowerCase()),
    ),
    [wantedAlbums],
  );
  const albums = useMemo(() => catalog?.albums ?? [], [catalog]);
  const stateFor = (album: AlbumReleaseGroup): ShelfState => {
    if (matchByAlbumId.get(album.id)?.ownership === "owned") return "owned";
    if (wantedIds.has(album.id.toLowerCase())) return "wanted";
    return "missing";
  };
  const studioAlbums = albums.filter((album) => category(album) === "studio");
  const ownedStudio = studioAlbums.filter((album) => stateFor(album) === "owned").length;
  const wantedStudio = studioAlbums.filter((album) => stateFor(album) === "wanted").length;
  const missingStudio = studioAlbums.length - ownedStudio - wantedStudio;
  const completion = studioAlbums.length ? Math.round((ownedStudio / studioAlbums.length) * 100) : 0;
  const decades = useMemo(() => [...new Set(albums.map(year).filter((value): value is number => value !== null).map((value) => Math.floor(value / 10) * 10))].sort(), [albums]);
  const visibleAlbums = albums.filter((album) => {
    if (releaseFilter !== "all" && category(album) !== releaseFilter) return false;
    const releaseYear = year(album);
    return decade === "all" || (releaseYear !== null && Math.floor(releaseYear / 10) * 10 === Number(decade));
  });
  const selectable = visibleAlbums.filter((album) => stateFor(album) === "missing");
  const selectedAlbums = albums.filter((album) => selectedIds.has(album.id) && stateFor(album) === "missing");
  const radarScanning = radarSnapshot.state === "scanning";

  const scan = (nextAlbums: AlbumReleaseGroup[]) => {
    if (!selectedArtist || nextAlbums.length === 0) return;
    void onScan(selectedArtist.canonicalName ?? selectedArtist.name, nextAlbums.slice(0, 12)).catch(() => undefined);
  };

  const queueSource = async (
    album: AlbumReleaseGroup,
    source: AlbumSource,
    availableSources: AlbumSource[],
  ) => {
    setPreparingSourceId(source.id);
    try {
      await onQueueSource(album, source, availableSources);
    } finally {
      setPreparingSourceId(null);
    }
  };

  const chooseArtist = (artist: ArchiveArtistSummary) => {
    setSelectedIds(new Set());
    setPreferences(defaultPreferences);
    setTrackCountMode(trackCountModeFor(defaultPreferences));
    setTrackCountError(null);
    setTrackCountNotice(null);
    setAddedCount(0);
    setReleaseFilter("studio");
    setDecade("all");
    void onSelectArtist(artist).catch(() => undefined);
  };

  const toggle = (album: AlbumReleaseGroup) => {
    if (stateFor(album) !== "missing") return;
    if (selectedIds.size === 0 && !selectedIds.has(album.id)) {
      setPreferences(defaultPreferences);
      setTrackCountMode(trackCountModeFor(defaultPreferences));
    }
    setTrackCountError(null);
    setTrackCountNotice(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(album.id)) next.delete(album.id);
      else next.add(album.id);
      return next;
    });
    setAddedCount(0);
  };

  const addSelected = async () => {
    if (!selectedArtist || selectedAlbums.length === 0) return;
    setAdding(true);
    setTrackCountError(null);
    setTrackCountNotice(null);
    try {
      const minimumTrackCounts: Record<string, number> = {};
      const fallbackAlbums: string[] = [];
      if (trackCountMode === "musicbrainz") {
        for (const album of selectedAlbums) {
          const officialTrackCount = await onResolveOfficialTrackCount(album).catch(() => null);
          if (officialTrackCount === null) fallbackAlbums.push(album.title);
          minimumTrackCounts[album.id] = officialTrackCount
            ?? defaultPreferences.minimumTrackCount
            ?? DEFAULT_TRACK_COUNT_FALLBACK;
        }
      }
      await onAddMany(selectedArtist.name, selectedAlbums, preferences, minimumTrackCounts);
      setAddedCount(selectedAlbums.length);
      setSelectedIds(new Set());
      if (fallbackAlbums.length > 0) {
        const fallbackTrackCount = defaultPreferences.minimumTrackCount
          ?? DEFAULT_TRACK_COUNT_FALLBACK;
        const subject = fallbackAlbums.length === 1
          ? fallbackAlbums[0]
          : `${fallbackAlbums.length} selected albums`;
        setTrackCountNotice(
          `MusicBrainz has no official track count for ${subject}. Added ${fallbackAlbums.length === 1 ? "it" : "them"} with the default ${fallbackTrackCount}-track minimum.`,
        );
      }
    } catch (cause) {
      setTrackCountError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="missing-shelf-workspace">
      <aside className="missing-artist-rail">
        <header><small>Artists in Music Library</small><strong>Choose a shelf</strong></header>
        <form onSubmit={(event) => {
          event.preventDefault();
          void onSearchArtists(artistQuery).catch(() => undefined);
        }}>
          <MagnifyingGlass size={15} />
          <input aria-label="Search Archive artists" value={artistQuery} placeholder="Filter artists" onChange={(event) => setArtistQuery(event.target.value)} />
          <button type="submit" aria-label="Search artists">Search</button>
        </form>
        <div className="missing-artist-list" aria-live="polite">
          {loading === "artists" ? (
            <span className="missing-rail-state"><CircleNotch className="search-spinner" size={19} /> Reading artist shelves…</span>
          ) : artists.length === 0 ? (
            <span className="missing-rail-state"><Database size={19} /> No Archive artists match.</span>
          ) : artists.map((artist) => (
            <button
              type="button"
              className={selectedArtist?.name === artist.name ? "is-active" : ""}
              key={artist.name}
              onClick={() => chooseArtist(artist)}
            >
              <span className="missing-artist-monogram">{artist.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{artist.name}</strong><small>{artist.ownedAlbumCount} owned · {artist.firstYear ?? "—"}–{artist.lastYear ?? "—"}</small></span>
              <i className={artist.cachedReleaseCount ? "is-cached" : ""} title={artist.cachedReleaseCount ? `${artist.cachedReleaseCount} cached official releases` : "Catalog will be looked up when selected"} />
            </button>
          ))}
        </div>
        {artistsTruncated ? <p className="missing-rail-footnote">Top 120 shown. Search to reach the rest.</p> : null}
      </aside>

      <section className="missing-catalog">
        {error ? (
          <div className="missing-shelf-error" role="alert"><WarningCircle size={17} weight="fill" /><span><strong>The shelf went quiet.</strong>{error}</span><button type="button" onClick={onDismissError}>Dismiss</button></div>
        ) : null}

        {identityOptions.length > 0 && selectedArtist ? (
          <section className="missing-identity-picker">
            <small>MusicBrainz identity needed</small>
            <h2>Which {selectedArtist.name} belongs to this shelf?</h2>
            <p>Forever keeps this choice in the current session and does not write it back to Music Library.</p>
            <div>{identityOptions.map((identity) => (
              <button type="button" key={identity.id} onClick={() => void onSelectIdentity(identity).catch(() => undefined)}>
                <strong>{identity.name}</strong><span>{[identity.artistType, identity.country, identity.disambiguation].filter(Boolean).join(" · ") || "No additional details"}</span><small>{identity.score}% match</small>
              </button>
            ))}</div>
          </section>
        ) : loading === "catalog" || loading === "identity" ? (
          <div className="missing-catalog-empty"><CircleNotch className="search-spinner" size={28} /><strong>{loading === "identity" ? "Finding the right artist" : "Comparing the catalog"}</strong><p>Only this selected artist is being checked.</p></div>
        ) : selectedArtist && catalog ? (
          <>
            <header className="missing-catalog-heading">
              <span>
                <small>Missing albums · {catalogSource === "archiveCache" ? "Music Library cache" : "MusicBrainz live"}</small>
                <h2>{selectedArtist.canonicalName ?? selectedArtist.name}</h2>
                <p>{catalogSource === "archiveCache" ? date(catalogFetchedAt) : "Looked up after you selected this artist"} · Archive remains read-only</p>
              </span>
              <div className="missing-completion" style={{ "--completion": `${completion * 3.6}deg` } as React.CSSProperties}>
                <span><strong>{ownedStudio}/{studioAlbums.length}</strong><small>studio albums</small></span>
              </div>
              <dl>
                <div><dt>Owned</dt><dd>{ownedStudio}</dd></div>
                <div><dt>Wanted</dt><dd>{wantedStudio}</dd></div>
                <div><dt>Missing</dt><dd>{missingStudio}</dd></div>
              </dl>
            </header>

            <div className="missing-filterbar">
              <div role="tablist" aria-label="Release type">
                {(["studio", "live", "compilation", "ep", "all"] as ReleaseFilter[]).map((filter) => (
                  <button type="button" role="tab" aria-selected={releaseFilter === filter} className={releaseFilter === filter ? "is-active" : ""} key={filter} onClick={() => setReleaseFilter(filter)}>{filter === "ep" ? "EP" : filter[0].toUpperCase() + filter.slice(1)}</button>
                ))}
              </div>
              <label><span>Era</span><select aria-label="Release year" value={decade} onChange={(event) => setDecade(event.target.value)}><option value="all">All years</option>{decades.map((value) => <option value={value} key={value}>{value}s</option>)}</select></label>
              <button type="button" className="missing-select-all" disabled={selectable.length === 0} onClick={() => { setPreferences(defaultPreferences); setTrackCountMode(trackCountModeFor(defaultPreferences)); setTrackCountError(null); setTrackCountNotice(null); setSelectedIds(new Set(selectable.map((album) => album.id))); }}><Check size={14} /> Select visible missing</button>
              <button type="button" className="shelf-radar-scan-visible" disabled={!online || !radarReady || radarScanning || selectable.length === 0} title={!online ? "Reconnect before scanning the network" : selectable.length > 12 ? "Scans the first 12 visible missing albums" : "Scan visible missing albums"} onClick={() => scan(selectable)}><Broadcast size={14} /> Scan visible{selectable.length > 12 ? " 12" : ""}</button>
            </div>

            {radarSnapshot.totalCount > 0 && (radarScanning || radarSnapshot.state === "stopped") ? (
              <section className={`shelf-radar-progress is-${radarSnapshot.state}`} aria-live="polite">
                <Broadcast size={18} />
                <span><strong>Shelf Radar · {radarSnapshot.completedCount}/{radarSnapshot.totalCount}</strong><small>{radarSnapshot.message}</small></span>
                <i><b style={{ width: `${radarSnapshot.totalCount ? Math.max(4, (radarSnapshot.completedCount / radarSnapshot.totalCount) * 100) : 0}%` }} /></i>
                {radarScanning ? <button type="button" onClick={() => void onStopScan().catch(() => undefined)}><Stop size={13} weight="fill" /> Stop</button> : null}
              </section>
            ) : null}

            {selectedAlbums.length > 0 || addedCount > 0 ? (
              <section className={`missing-bulk-bar ${addedCount ? "is-complete" : ""}`} aria-live="polite">
                <span><SlidersHorizontal size={18} /><strong>{addedCount ? `${addedCount} added to Wanted` : `${selectedAlbums.length} missing selected`}</strong><small>{addedCount ? "Smart Match will begin listening on its normal rhythm." : "One Smart Match profile will be shared by this batch."}</small></span>
                {!addedCount ? <>
                  <label><span>Format</span><select aria-label="Bulk format preference" value={preferences.formatPreference} onChange={(event) => setPreferences((current) => ({ ...current, formatPreference: event.target.value as WantedFormatPreference }))}><option value="preferLossless">Prefer FLAC</option><option value="losslessOnly">Lossless only</option><option value="mp3Only">MP3 only</option><option value="any">Any format</option></select></label>
                  <label><span>Lossy floor</span><select aria-label="Bulk minimum bitrate" disabled={preferences.formatPreference === "losslessOnly"} value={preferences.minimumBitrateKbps ?? 0} onChange={(event) => setPreferences((current) => ({ ...current, minimumBitrateKbps: Number(event.target.value) ? Number(event.target.value) as 128 | 192 | 256 | 320 : null }))}><option value={320}>320 kbps</option><option value={256}>256 kbps</option><option value={192}>192 kbps</option><option value={128}>128 kbps</option><option value={0}>Any</option></select></label>
                  <label className="missing-track-count"><span>Tracks</span><span className={`missing-track-count-control is-${trackCountMode}`}><select aria-label="Bulk track count mode" value={trackCountMode} onChange={(event) => { const mode = event.target.value as TrackCountMode; setTrackCountMode(mode); setTrackCountError(null); setTrackCountNotice(null); if (mode !== "custom") setPreferences((current) => ({ ...current, minimumTrackCount: null })); }}><option value="any">Any</option><option value="custom">Custom</option><option value="musicbrainz">MusicBrainz</option></select>{trackCountMode === "custom" ? <input aria-label="Bulk custom track count" type="number" min={1} max={250} placeholder="#" value={preferences.minimumTrackCount ?? ""} onChange={(event) => { setTrackCountError(null); setTrackCountNotice(null); setPreferences((current) => ({ ...current, minimumTrackCount: event.target.value ? Number(event.target.value) : null })); }} /> : null}</span></label>
                  <button type="button" className="missing-scan-selected" disabled={!online || radarScanning} onClick={() => scan(selectedAlbums)}><Broadcast size={15} /> Scan {Math.min(selectedAlbums.length, 12)}</button>
                  <button type="button" className="missing-add-wanted" disabled={adding || (trackCountMode === "custom" && (preferences.minimumTrackCount === null || !Number.isInteger(preferences.minimumTrackCount) || preferences.minimumTrackCount < 1 || preferences.minimumTrackCount > 250))} onClick={() => void addSelected()}><Plus size={15} weight="bold" />{adding ? trackCountMode === "musicbrainz" ? "Reading MusicBrainz…" : "Adding…" : `Add ${selectedAlbums.length} to Wanted`}</button>
                </> : null}
                {trackCountNotice ? <p className="missing-track-count-notice" role="status">{trackCountNotice}</p> : null}
                {trackCountError ? <p className="missing-track-count-error" role="alert">{trackCountError}</p> : null}
              </section>
            ) : null}

            <div className="missing-release-list" aria-live="polite">
              {visibleAlbums.length === 0 ? <div className="missing-catalog-empty"><Record size={28} weight="thin" /><strong>No releases in this filter</strong><p>Try another release type or era.</p></div> : visibleAlbums.map((album) => {
                const shelfState = stateFor(album);
                const selected = shelfState === "missing" && selectedIds.has(album.id);
                const archiveMatch = matchByAlbumId.get(album.id);
                const radarScan = radarScans.get(album.id);
                const sources = groupAlbumSources(radarResults.get(album.id) ?? []).filter((source) => source.tracks.length > 0);
                const lossless = sources.some((source) => source.formats.some((format) => losslessFormats.has(format)));
                const radarLabel = radarScan?.state === "queued" ? "Queued" : radarScan?.state === "scanning" ? "Scanning" : radarScan?.state === "error" ? "Scan failed" : sources.length ? lossless ? "Lossless found" : `${sources.length} ${sources.length === 1 ? "source" : "sources"}` : radarScan?.state === "completed" ? "No sources" : "Not scanned";
                const radarClass = radarScan?.state === "scanning" ? "is-scanning" : radarScan?.state === "queued" ? "is-queued" : radarScan?.state === "error" ? "is-error" : sources.length ? lossless ? "is-lossless" : "is-found" : radarScan?.state === "completed" ? "is-empty" : "is-idle";
                const radarOpen = openRadarAlbumId === album.id && sources.length > 0;
                return (
                  <div className={`missing-release-block ${radarOpen ? "is-radar-open" : ""}`} key={album.id}>
                    <article className={`missing-release-row is-${shelfState} ${selected ? "is-selected" : ""}`}>
                      <button type="button" className="missing-release-check" aria-label={`${selected ? "Deselect" : "Select"} ${album.title}`} aria-pressed={selected} disabled={shelfState !== "missing"} onClick={() => toggle(album)}>{selected || shelfState === "owned" ? <Check size={13} weight="bold" /> : shelfState === "wanted" ? <Plus size={12} /> : null}</button>
                      <ReleaseArtwork album={album} />
                      <span className="missing-release-title"><small>{year(album) ?? "Year unknown"} · {category(album)}</small><strong>{album.title}</strong><p>{album.primaryType ?? "Release group"}{album.secondaryTypes.length ? ` · ${album.secondaryTypes.join(" + ")}` : " · Official catalog"}</p></span>
                      <span className="missing-release-local"><small>{shelfState === "owned" ? "Music Library match" : shelfState === "wanted" ? "Forever watchlist" : "Collection gap"}</small><strong>{shelfState === "owned" ? archiveMatch?.localTitle ?? "Owned" : shelfState === "wanted" ? "Wanted" : "Don’t own"}</strong><p>{shelfState === "owned" ? `${archiveMatch?.trackCount ?? "—"} tracks · ${archiveMatch?.localYear ?? "year unknown"}` : shelfState === "wanted" ? "Smart Match is listening" : "Ready for Shelf Radar"}</p></span>
                      {shelfState === "missing" ? <button type="button" className={`shelf-radar-status ${radarClass}`} disabled={!online || radarScanning} onClick={() => sources.length ? setOpenRadarAlbumId(radarOpen ? null : album.id) : scan([album])} title={sources.length ? "Show or hide available album sources" : online ? "Scan this album" : "Reconnect before scanning"}>{radarScan?.state === "scanning" ? <CircleNotch className="search-spinner" size={14} /> : sources.length ? <Eye size={14} /> : <Broadcast size={14} />}<span><strong>{radarLabel}</strong><small>{sources.length ? `${radarScan?.peerCount ?? 0} people replied` : radarScan?.state === "completed" ? "Click to rescan" : "Click to listen"}</small></span></button> : <span className="shelf-radar-unavailable">{shelfState === "wanted" ? "Watch active" : "In library"}</span>}
                      <strong className={`missing-release-state is-${shelfState}`}>{shelfState === "owned" ? <CheckCircle size={14} weight="fill" /> : shelfState === "wanted" ? <Plus size={13} weight="bold" /> : <span aria-hidden="true" />}{shelfState === "owned" ? "Own" : shelfState === "wanted" ? "Wanted" : "Missing"}</strong>
                    </article>
                    {radarOpen ? <RadarSourceDrawer album={album} sources={sources} transfers={transfers} preferences={preferences} watched={wantedIds.has(album.id.toLowerCase())} preparingSourceId={preparingSourceId} onDownload={(source) => void queueSource(album, source, sources).catch(() => undefined)} onWatch={() => void onAddMany(selectedArtist.canonicalName ?? selectedArtist.name, [album], preferences).catch(() => undefined)} onRescan={() => scan([album])} onOpenTransfer={onOpenTransfer} /> : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="missing-catalog-empty"><Record size={30} weight="thin" /><strong>Choose an artist shelf</strong><p>Forever compares only the artist you select—never your entire library in the background.</p></div>
        )}
      </section>
    </div>
  );
}
