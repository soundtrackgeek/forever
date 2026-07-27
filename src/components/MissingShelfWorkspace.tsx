import {
  Check,
  CheckCircle,
  CircleNotch,
  Database,
  MagnifyingGlass,
  Plus,
  Record,
  SlidersHorizontal,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type {
  AlbumArtist,
  AlbumCatalog,
  AlbumReleaseGroup,
  ArchiveAlbumMatch,
  ArchiveArtistSummary,
  WantedAlbum,
  WantedFormatPreference,
  WantedPreferences,
} from "../types";
import type { MissingShelfLoading } from "../hooks/useMissingShelf";

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
  onSearchArtists: (query: string) => Promise<ArchiveArtistSummary[]>;
  onSelectArtist: (artist: ArchiveArtistSummary) => Promise<AlbumCatalog | null>;
  onSelectIdentity: (artist: AlbumArtist) => Promise<AlbumCatalog | null>;
  onAddMany: (
    artist: string,
    albums: AlbumReleaseGroup[],
    preferences: WantedPreferences,
  ) => Promise<unknown>;
  onDismissError: () => void;
};

type ReleaseFilter = "studio" | "live" | "compilation" | "ep" | "all";
type ShelfState = "owned" | "wanted" | "missing";

const defaultPreferences: WantedPreferences = {
  formatPreference: "preferLossless",
  minimumBitrateKbps: 320,
  minimumTrackCount: null,
};

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
  onSearchArtists,
  onSelectArtist,
  onSelectIdentity,
  onAddMany,
  onDismissError,
}: MissingShelfWorkspaceProps) {
  const [artistQuery, setArtistQuery] = useState(query);
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("studio");
  const [decade, setDecade] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const wantedIds = useMemo(
    () => new Set(wantedAlbums.map((album) => album.albumId.toLowerCase())),
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

  const chooseArtist = (artist: ArchiveArtistSummary) => {
    setSelectedIds(new Set());
    setAddedCount(0);
    setReleaseFilter("studio");
    setDecade("all");
    void onSelectArtist(artist).catch(() => undefined);
  };

  const toggle = (album: AlbumReleaseGroup) => {
    if (stateFor(album) !== "missing") return;
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
    try {
      await onAddMany(selectedArtist.name, selectedAlbums, preferences);
      setAddedCount(selectedAlbums.length);
      setSelectedIds(new Set());
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
              <button type="button" className="missing-select-all" disabled={selectable.length === 0} onClick={() => setSelectedIds(new Set(selectable.map((album) => album.id)))}><Check size={14} /> Select visible missing</button>
            </div>

            {selectedAlbums.length > 0 || addedCount > 0 ? (
              <section className={`missing-bulk-bar ${addedCount ? "is-complete" : ""}`} aria-live="polite">
                <span><SlidersHorizontal size={18} /><strong>{addedCount ? `${addedCount} added to Wanted` : `${selectedAlbums.length} missing selected`}</strong><small>{addedCount ? "Smart Match will begin listening on its normal rhythm." : "One Smart Match profile will be shared by this batch."}</small></span>
                {!addedCount ? <>
                  <label><span>Format</span><select aria-label="Bulk format preference" value={preferences.formatPreference} onChange={(event) => setPreferences((current) => ({ ...current, formatPreference: event.target.value as WantedFormatPreference }))}><option value="preferLossless">Prefer FLAC</option><option value="losslessOnly">Lossless only</option><option value="any">Any format</option></select></label>
                  <label><span>Lossy floor</span><select aria-label="Bulk minimum bitrate" disabled={preferences.formatPreference === "losslessOnly"} value={preferences.minimumBitrateKbps ?? 0} onChange={(event) => setPreferences((current) => ({ ...current, minimumBitrateKbps: Number(event.target.value) ? Number(event.target.value) as 128 | 192 | 256 | 320 : null }))}><option value={320}>320 kbps</option><option value={256}>256 kbps</option><option value={192}>192 kbps</option><option value={128}>128 kbps</option><option value={0}>Any</option></select></label>
                  <label><span>Tracks</span><input aria-label="Bulk minimum track count" type="number" min={1} max={250} placeholder="Any" value={preferences.minimumTrackCount ?? ""} onChange={(event) => setPreferences((current) => ({ ...current, minimumTrackCount: event.target.value ? Number(event.target.value) : null }))} /></label>
                  <button type="button" className="missing-add-wanted" disabled={adding} onClick={() => void addSelected().catch(() => undefined)}><Plus size={15} weight="bold" />{adding ? "Adding…" : `Add ${selectedAlbums.length} to Wanted`}</button>
                </> : null}
              </section>
            ) : null}

            <div className="missing-release-list" aria-live="polite">
              {visibleAlbums.length === 0 ? <div className="missing-catalog-empty"><Record size={28} weight="thin" /><strong>No releases in this filter</strong><p>Try another release type or era.</p></div> : visibleAlbums.map((album) => {
                const shelfState = stateFor(album);
                const selected = shelfState === "missing" && selectedIds.has(album.id);
                const archiveMatch = matchByAlbumId.get(album.id);
                return (
                  <article className={`missing-release-row is-${shelfState} ${selected ? "is-selected" : ""}`} key={album.id}>
                    <button type="button" className="missing-release-check" aria-label={`${selected ? "Deselect" : "Select"} ${album.title}`} aria-pressed={selected} disabled={shelfState !== "missing"} onClick={() => toggle(album)}>{selected || shelfState === "owned" ? <Check size={13} weight="bold" /> : shelfState === "wanted" ? <Plus size={12} /> : null}</button>
                    <ReleaseArtwork album={album} />
                    <span className="missing-release-title"><small>{year(album) ?? "Year unknown"} · {category(album)}</small><strong>{album.title}</strong><p>{album.primaryType ?? "Release group"}{album.secondaryTypes.length ? ` · ${album.secondaryTypes.join(" + ")}` : " · Official catalog"}</p></span>
                    <span className="missing-release-local"><small>{shelfState === "owned" ? "Music Library match" : shelfState === "wanted" ? "Forever watchlist" : "Collection gap"}</small><strong>{shelfState === "owned" ? archiveMatch?.localTitle ?? "Owned" : shelfState === "wanted" ? "Wanted" : "Don’t own"}</strong><p>{shelfState === "owned" ? `${archiveMatch?.trackCount ?? "—"} tracks · ${archiveMatch?.localYear ?? "year unknown"}` : shelfState === "wanted" ? "Smart Match is listening" : "Ready to add as Wanted"}</p></span>
                    <strong className={`missing-release-state is-${shelfState}`}>{shelfState === "owned" ? <CheckCircle size={14} weight="fill" /> : shelfState === "wanted" ? <Plus size={13} weight="bold" /> : <span aria-hidden="true" />}{shelfState === "owned" ? "Own" : shelfState === "wanted" ? "Wanted" : "Missing"}</strong>
                  </article>
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
