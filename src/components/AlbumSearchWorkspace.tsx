import {
  ArrowRight,
  CircleNotch,
  Disc,
  MagnifyingGlass,
  MusicNotesPlus,
  Record,
  WarningCircle,
} from "@phosphor-icons/react";
import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import type { AlbumArtist, AlbumCatalog, AlbumReleaseGroup, ConnectionSnapshot } from "../types";
import { CountryFlag } from "./CountryFlag";
import { SearchModeSwitch, type SearchMode } from "./SearchModeSwitch";

type AlbumFilter = "studio" | "live" | "compilation" | "ep" | "all";

type AlbumSearchWorkspaceProps = {
  query: string;
  artists: AlbumArtist[];
  selectedArtist: AlbumArtist | null;
  catalog: AlbumCatalog | null;
  loading: "idle" | "artists" | "catalog";
  error: string | null;
  connection: ConnectionSnapshot;
  searchMode: SearchMode;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onSelectArtist: (artist: AlbumArtist) => void;
  onSearchModeChange: (mode: SearchMode) => void;
  onSearchSoulseek: (artist: string, album: AlbumReleaseGroup) => void;
  onOpenConnection: () => void;
  onDismissError: () => void;
};

const filterLabels: Record<AlbumFilter, string> = {
  studio: "Studio albums",
  live: "Live",
  compilation: "Compilations",
  ep: "EPs",
  all: "All releases",
};

const secondaryTypes = (album: AlbumReleaseGroup) =>
  new Set(album.secondaryTypes.map((value) => value.toLowerCase()));

const matchesFilter = (album: AlbumReleaseGroup, filter: AlbumFilter) => {
  const secondary = secondaryTypes(album);
  if (filter === "all") return true;
  if (filter === "ep") return album.primaryType?.toLowerCase() === "ep";
  if (filter === "live") return secondary.has("live");
  if (filter === "compilation") return secondary.has("compilation");
  return (
    album.primaryType?.toLowerCase() === "album" &&
    !secondary.has("live") &&
    !secondary.has("compilation") &&
    !secondary.has("remix") &&
    !secondary.has("soundtrack")
  );
};

function AlbumCover({ album }: { album: AlbumReleaseGroup }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="album-cover">
      {!failed && album.coverArtUrl ? (
        <img
          src={album.coverArtUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="album-cover-fallback" aria-hidden="true">
          <Record size={34} weight="thin" />
          <small>{album.title.slice(0, 1)}</small>
        </span>
      )}
    </span>
  );
}

export function AlbumSearchWorkspace({
  query,
  artists,
  selectedArtist,
  catalog,
  loading,
  error,
  connection,
  searchMode,
  onQueryChange,
  onSearch,
  onSelectArtist,
  onSearchModeChange,
  onSearchSoulseek,
  onOpenConnection,
  onDismissError,
}: AlbumSearchWorkspaceProps) {
  const [filter, setFilter] = useState<AlbumFilter>("studio");
  const deferredCatalog = useDeferredValue(catalog);
  const online = connection.state === "online";
  const visibleAlbums = useMemo(
    () => deferredCatalog?.albums.filter((album) => matchesFilter(album, filter)) ?? [],
    [deferredCatalog, filter],
  );
  const counts = useMemo(
    () =>
      (Object.keys(filterLabels) as AlbumFilter[]).reduce<Record<AlbumFilter, number>>(
        (result, value) => ({
          ...result,
          [value]: deferredCatalog?.albums.filter((album) => matchesFilter(album, value)).length ?? 0,
        }),
        { studio: 0, live: 0, compilation: 0, ep: 0, all: 0 },
      ),
    [deferredCatalog],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = String(new FormData(event.currentTarget).get("album-artist") ?? "").trim();
    if (next) onSearch(next);
  };

  return (
    <section className="album-workspace" aria-label="Album discovery">
      <div className="album-network-toolbar">
        <button
          type="button"
          className={`network-status is-${connection.state}`}
          onClick={onOpenConnection}
          title={connection.message}
        >
          <i aria-hidden="true" /> {online ? "Network online" : "Soulseek offline"}
        </button>
        <form className="global-search" onSubmit={submit}>
          <button
            type="submit"
            className="search-submit"
            aria-label="Find albums"
            disabled={!query.trim() || loading !== "idle"}
          >
            {loading === "artists" ? (
              <CircleNotch className="search-spinner" size={18} />
            ) : (
              <MagnifyingGlass size={18} weight="light" />
            )}
          </button>
          <SearchModeSwitch mode={searchMode} onChange={onSearchModeChange} />
          <input
            name="album-artist"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Search an artist's albums"
            placeholder="Enter an artist to open their discography"
            maxLength={180}
          />
        </form>
        <span className="album-source-note">MusicBrainz catalog</span>
      </div>

      <header className="album-heading">
        <span className="eyebrow"><Disc size={14} /> Album signal</span>
        <h1>Find the record. Then find the files.</h1>
        <p>Choose a cataloged release and Forever will search Soulseek using the artist and album title.</p>
      </header>

      {error ? (
        <div className="album-error" role="alert">
          <WarningCircle size={19} weight="fill" />
          <span><strong>Album discovery went quiet.</strong>{error}</span>
          <button type="button" onClick={onDismissError}>Dismiss</button>
        </div>
      ) : null}

      {!selectedArtist && artists.length > 0 ? (
        <section className="artist-choices" aria-label="Matching artists">
          <header><span>Choose the right artist</span><small>{artists.length} matches</small></header>
          <div>
            {artists.map((artist) => (
              <button type="button" onClick={() => onSelectArtist(artist)} key={artist.id}>
                <span className="artist-choice-mark">{artist.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{artist.name}</strong><small>{artist.disambiguation || [artist.artistType, artist.country].filter(Boolean).join(" · ") || "MusicBrainz artist"}</small></span>
                <CountryFlag code={artist.country} />
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {loading === "catalog" ? (
        <div className="album-loading" aria-live="polite">
          <span><CircleNotch className="search-spinner" size={28} /><Disc size={17} /></span>
          <strong>Opening the discography</strong>
          <p>MusicBrainz asks clients to keep a calm one-request-per-second rhythm.</p>
        </div>
      ) : selectedArtist && deferredCatalog ? (
        <div className="album-catalog">
          <header className="album-artist-header">
            <div className="album-artist-monogram">{selectedArtist.name.slice(0, 1).toUpperCase()}</div>
            <div>
              <span className="eyebrow">Discography</span>
              <h2><CountryFlag code={selectedArtist.country} />{selectedArtist.name}</h2>
              <p>{selectedArtist.disambiguation || [selectedArtist.artistType, selectedArtist.country].filter(Boolean).join(" · ")}</p>
            </div>
            <dl>
              <div><dt>Cataloged</dt><dd>{deferredCatalog.albums.length}</dd></div>
              <div><dt>In view</dt><dd>{visibleAlbums.length}</dd></div>
            </dl>
          </header>

          <div className="album-filter-rail" role="tablist" aria-label="Album types">
            {(Object.keys(filterLabels) as AlbumFilter[]).map((value) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}
                key={value}
              >
                {filterLabels[value]} <small>{counts[value]}</small>
              </button>
            ))}
          </div>

          <div className="album-grid" aria-live="polite">
            {visibleAlbums.length ? visibleAlbums.map((album) => (
              <article className="album-card" key={album.id}>
                <AlbumCover album={album} />
                <div className="album-card-copy">
                  <span>{album.firstReleaseDate.slice(0, 4) || "Year unknown"}</span>
                  <h3>{album.title}</h3>
                  <p>{[album.primaryType, ...album.secondaryTypes].filter(Boolean).join(" · ")}</p>
                  <button
                    type="button"
                    disabled={!online}
                    aria-label={`${online ? "Search Soulseek for" : "Connect before searching for"} ${album.title}`}
                    title={online ? `Search Soulseek for ${album.title}` : "Connect to Soulseek first"}
                    onClick={() => onSearchSoulseek(selectedArtist.name, album)}
                  >
                    <MusicNotesPlus size={15} /> {online ? "Search Soulseek" : "Connect to search"}
                  </button>
                </div>
              </article>
            )) : (
              <div className="album-empty">
                <Record size={31} weight="thin" />
                <strong>No {filterLabels[filter].toLowerCase()} are cataloged</strong>
                <p>Try another release type above.</p>
              </div>
            )}
          </div>
          {deferredCatalog.truncated ? <small className="album-truncated">Showing the first 300 catalog entries.</small> : null}
        </div>
      ) : (
        <div className="album-empty-state">
          <span><Record size={47} weight="thin" /><i /></span>
          <h2>Start with the artist</h2>
          <p>Forever resolves the discography first, so your Soulseek search stays precise without hiding alternate rips or editions.</p>
        </div>
      )}
    </section>
  );
}
