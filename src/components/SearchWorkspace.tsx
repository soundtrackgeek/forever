import {
  ArrowRight,
  CaretDown,
  CircleNotch,
  Disc,
  DownloadSimple,
  FunnelSimple,
  FolderOpen,
  GridFour,
  ListBullets,
  MagnifyingGlass,
  ShieldCheck,
  Star,
  Stop,
  UserCircle,
  XCircle,
} from "@phosphor-icons/react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  AlbumSearchContext,
  AlbumSource,
  ArchiveAlbumMatch,
  ConnectionSnapshot,
  SearchResult,
  SearchSnapshot,
  PersonProfile,
  Transfer,
  WantedAlbum,
} from "../types";
import { groupAlbumSources } from "../utils/albumSources";
import { AlbumSourceResults } from "./AlbumSourceResults";
import { ArchiveOwnershipBadge } from "./ArchiveOwnershipBadge";
import { CountryFlag } from "./CountryFlag";
import { SearchModeSwitch, type SearchMode } from "./SearchModeSwitch";
import { WantedToggle } from "./WantedToggle";

export type SearchFilter = "all" | "lossless" | "compressed";
export type SearchSort = "best" | "ready" | "fast" | "small";
export type AlbumResultView = "sources" | "files";

type SearchWorkspaceProps = {
  presetRail: ReactNode;
  sessionId: string;
  filter: SearchFilter;
  sort: SearchSort;
  layout: "list" | "grid";
  searchMode: SearchMode;
  albumContext: AlbumSearchContext | null;
  albumResultView: AlbumResultView;
  archiveConnected: boolean;
  archiveLoading: boolean;
  archiveMatch?: ArchiveAlbumMatch;
  wantedAlbum: WantedAlbum | null;
  query: string;
  results: SearchResult[];
  transfers: Transfer[];
  selectedResult: SearchResult | null;
  search: SearchSnapshot;
  searchError: string | null;
  connection: ConnectionSnapshot;
  onOpenConnection: () => void;
  onFilterChange: (filter: SearchFilter) => void;
  onSortChange: (sort: SearchSort) => void;
  onLayoutChange: (layout: "list" | "grid") => void;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onStopSearch: () => void;
  onSelectResult: (result: SearchResult) => void;
  onQueueDownload: (result: SearchResult) => void;
  onQueueAlbumSource: (source: AlbumSource) => Promise<void>;
  onOpenTransfer: (groupId: string) => void;
  onBrowseUser: (username: string) => void;
  personByUsername: (username: string) => PersonProfile | null;
  onOpenPerson: (username: string) => void;
  onSearchModeChange: (mode: SearchMode) => void;
  onAlbumResultViewChange: (view: AlbumResultView) => void;
  onToggleWanted: () => Promise<unknown>;
};

const losslessFormats = new Set(["FLAC", "ALAC", "WAV", "AIFF", "APE", "WV"]);
const compressedFormats = new Set(["MP3", "AAC", "M4A", "OGG", "OPUS", "WMA"]);

function AvailabilityBars({ values }: { values: number[] }) {
  return (
    <span className="availability-bars" aria-label="Availability signal">
      {values.map((value, index) => (
        <i key={`${value}-${index}`} style={{ height: `${value}%` }} />
      ))}
    </span>
  );
}

function Rating({ result }: { result: SearchResult }) {
  return (
    <span className="rating">
      <span aria-label={`${result.rating} out of 5 signal rating`}>
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            className={index < result.rating ? "is-filled" : ""}
            key={index}
            size={10}
            weight={index < result.rating ? "fill" : "regular"}
          />
        ))}
      </span>
      <small>{result.ratingLabel}</small>
    </span>
  );
}

function AlbumResultArtwork({ context }: { context: AlbumSearchContext }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="album-result-artwork">
      {!failed && context.coverArtUrl ? (
        <img src={context.coverArtUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <Disc size={42} weight="thin" aria-hidden="true" />
      )}
    </span>
  );
}

const filterLabels: Record<SearchFilter, string> = {
  all: "All types",
  lossless: "Lossless audio",
  compressed: "Compressed audio",
};

const sortLabels: Record<SearchSort, string> = {
  best: "Best match",
  ready: "Ready first",
  fast: "Fastest first",
  small: "Smallest first",
};

export function SearchWorkspace({
  presetRail,
  sessionId,
  filter,
  sort,
  layout,
  searchMode,
  albumContext,
  albumResultView,
  archiveConnected,
  archiveLoading,
  archiveMatch,
  wantedAlbum,
  query,
  results,
  transfers,
  selectedResult,
  search,
  searchError,
  connection,
  onOpenConnection,
  onFilterChange,
  onSortChange,
  onLayoutChange,
  onQueryChange,
  onSearch,
  onStopSearch,
  onSelectResult,
  onQueueDownload,
  onQueueAlbumSource,
  onOpenTransfer,
  onBrowseUser,
  personByUsername,
  onOpenPerson,
  onSearchModeChange,
  onAlbumResultViewChange,
  onToggleWanted,
}: SearchWorkspaceProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const resultListRef = useRef<HTMLDivElement>(null);
  const scrollBySession = useRef(new Map<string, number>());

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (resultListRef.current) resultListRef.current.scrollTop = scrollBySession.current.get(sessionId) ?? 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sessionId]);
  const online = connection.state === "online";
  const searching = search.state === "searching";
  const preview = search.message.startsWith("Preview data");
  const deferredResults = useDeferredValue(results);
  const losslessCount = results.filter((result) =>
    losslessFormats.has(result.format),
  ).length;
  const compressedCount = results.filter((result) =>
    compressedFormats.has(result.format),
  ).length;
  const albumSources = useMemo(
    () => groupAlbumSources(deferredResults),
    [deferredResults],
  );
  const sourceCounts = useMemo(() => {
    let lossless = 0;
    let compressed = 0;
    for (const source of albumSources) {
      if (source.formats.some((format) => losslessFormats.has(format))) lossless += 1;
      if (source.formats.some((format) => compressedFormats.has(format))) compressed += 1;
    }
    return { lossless, compressed };
  }, [albumSources]);

  const visibleResults = useMemo(() => {
    const filtered = results.filter((result) => {
      if (filter === "lossless") return losslessFormats.has(result.format);
      if (filter === "compressed") return compressedFormats.has(result.format);
      return true;
    });
    if (sort === "ready") {
      return [...filtered].sort(
        (left, right) =>
          Number(Boolean(right.slotFree)) - Number(Boolean(left.slotFree)) ||
          (left.queueLength ?? 0) - (right.queueLength ?? 0),
      );
    }
    if (sort === "fast") {
      return [...filtered].sort(
        (left, right) => (right.averageSpeed ?? 0) - (left.averageSpeed ?? 0),
      );
    }
    if (sort === "small") {
      return [...filtered].sort(
        (left, right) => (left.sizeBytes ?? 0) - (right.sizeBytes ?? 0),
      );
    }
    return filtered;
  }, [filter, results, sort]);

  const visibleAlbumSources = useMemo(() => {
    const filtered = albumSources.filter((source) => {
      if (filter === "lossless") {
        return source.formats.some((format) => losslessFormats.has(format));
      }
      if (filter === "compressed") {
        return source.formats.some((format) => compressedFormats.has(format));
      }
      return true;
    });
    if (sort === "ready") {
      return [...filtered].sort(
        (left, right) =>
          Number(right.slotFree) - Number(left.slotFree) ||
          left.queueLength - right.queueLength,
      );
    }
    if (sort === "fast") {
      return [...filtered].sort(
        (left, right) => right.averageSpeed - left.averageSpeed,
      );
    }
    if (sort === "small") {
      return [...filtered].sort(
        (left, right) => left.totalSizeBytes - right.totalSizeBytes,
      );
    }
    return filtered;
  }, [albumSources, filter, sort]);

  const showingAlbumSources = Boolean(albumContext) && albumResultView === "sources";
  const visibleCount = showingAlbumSources
    ? visibleAlbumSources.length
    : visibleResults.length;

  const connectionLabel =
    connection.state === "online"
      ? "Network online"
      : connection.state === "connecting" ||
          connection.state === "authenticating"
        ? "Connecting"
        : connection.state === "reconnecting"
          ? `Retrying in ${connection.retryInSeconds ?? "a few"}s`
          : connection.state === "error"
            ? "Connection needs attention"
            : "Network offline";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = String(
      new FormData(event.currentTarget).get("network-query") ?? "",
    ).trim();
    if (nextQuery) onSearch(nextQuery);
  };

  return (
    <section className="search-workspace" id="dial-search-surface" aria-label="Search workspace">
      <div className="network-toolbar">
        <button
          type="button"
          className={`network-status is-${connection.state}`}
          onClick={onOpenConnection}
          title={connection.message}
        >
          <i aria-hidden="true" /> {connectionLabel}
        </button>

        <form className="global-search" onSubmit={submit}>
          <button
            type="submit"
            className="search-submit"
            aria-label="Search"
            disabled={!online || searching || !query.trim()}
          >
            {searching ? (
              <CircleNotch className="search-spinner" size={18} />
            ) : (
              <MagnifyingGlass size={18} weight="light" />
            )}
          </button>
          <SearchModeSwitch mode={searchMode} onChange={onSearchModeChange} />
          <input
            name="network-query"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (
                event.key !== "Enter" ||
                searching ||
                !event.currentTarget.value.trim()
              ) {
                return;
              }
              event.preventDefault();
              onSearch(event.currentTarget.value.trim());
            }}
            aria-label="Search the network"
            placeholder="Search artist, album, track, or filename"
            disabled={!online}
            maxLength={250}
          />
          {query && (
            <button
              type="button"
              className="clear-search"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
            >
              <XCircle size={15} weight="fill" />
            </button>
          )}
        </form>

        <div className="filter-wrap">
          <button
            type="button"
            className={`toolbar-button ${filterOpen ? "is-open" : ""}`}
            disabled={results.length === 0}
            aria-expanded={filterOpen}
            onClick={() => {
              setFilterOpen((open) => !open);
              setSortOpen(false);
            }}
          >
            <FunnelSimple size={17} weight="light" />
            <span>{filterLabels[filter]}</span>
            <CaretDown size={12} weight="bold" />
          </button>
          {filterOpen && (
            <div className="filter-popover" role="menu">
              {(
                [
                  ["all", showingAlbumSources ? albumSources.length : results.length],
                  ["lossless", showingAlbumSources ? sourceCounts.lossless : losslessCount],
                  ["compressed", showingAlbumSources ? sourceCounts.compressed : compressedCount],
                ] as const
              ).map(([value, count]) => (
                <button
                  type="button"
                  role="menuitem"
                  className={filter === value ? "is-active" : ""}
                  key={value}
                  onClick={() => {
                    onFilterChange(value);
                    setFilterOpen(false);
                  }}
                >
                  {filterLabels[value]} <span>{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {presetRail}

      <header className="workspace-heading">
        <h1>Across the network</h1>
        <p>Discover rare music shared by real people.</p>
      </header>

      {preview && search.query === "night geometry" && !albumContext ? (
        <article className="featured-release">
          <img
            className="featured-art"
            src="/assets/night-geometry-cover.png"
            alt="Night Geometry cover: a violet moon behind a dark monolith"
          />
          <div className="featured-copy">
            <span className="eyebrow">Rare find</span>
            <h2>Night Geometry</h2>
            <p>Liminal Structures</p>
            <small>
              2019&nbsp;&nbsp;•&nbsp;&nbsp;10 tracks&nbsp;&nbsp;•&nbsp;&nbsp;53:21
            </small>
            <div className="format-row">
              <span>FLAC</span>
              <span className="is-amber">24 bit / 96 kHz</span>
              <span>VINYL RIP</span>
            </div>
            <p className="availability-note">
              <Star size={12} weight="fill" /> Very few copies available
            </p>
          </div>
          {selectedResult && (
            <AvailabilityBars values={selectedResult.availability} />
          )}
          <button
            type="button"
            className="view-release-button"
            onClick={() => {
              const first = visibleResults[0] ?? selectedResult;
              if (first) onSelectResult(first);
            }}
          >
            View release <ArrowRight size={16} />
          </button>
        </article>
      ) : (
        <article className={`live-search-card is-${search.state} ${albumContext ? "is-album-search" : ""}`}>
          {albumContext ? (
            <AlbumResultArtwork key={albumContext.coverArtUrl} context={albumContext} />
          ) : (
            <span className="live-search-signal" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
          <div>
            <span className="eyebrow">
              {albumContext
                ? searching
                  ? "Finding album sources"
                  : "Album source report"
                : searching
                  ? "Live signal"
                  : "Search report"}
            </span>
            <h2>
              {albumContext
                ? `${albumContext.title} — ${albumContext.artist}`
                : search.query
                  ? `“${search.query}”`
                  : "Ready to listen"}
            </h2>
            <p>{searchError ?? search.message}</p>
            {albumContext ? (
              <span className="album-search-statuses">
                <ArchiveOwnershipBadge
                  match={archiveMatch}
                  archiveConnected={archiveConnected}
                  loading={archiveLoading}
                />
                {archiveMatch?.ownership !== "owned" ? (
                  <WantedToggle
                    watched={Boolean(wantedAlbum)}
                    albumTitle={albumContext.title}
                    onToggle={onToggleWanted}
                  />
                ) : null}
              </span>
            ) : null}
          </div>
          <dl>
            <div>
              <dt>Files</dt>
              <dd>{search.resultCount}</dd>
            </div>
            {albumContext ? (
              <div>
                <dt>Sources</dt>
                <dd>{albumSources.length}</dd>
              </div>
            ) : null}
            <div>
              <dt>People</dt>
              <dd>{search.peerCount}</dd>
            </div>
          </dl>
          {searching && (
            <button
              type="button"
              className="stop-search-button"
              onClick={onStopSearch}
            >
              <Stop size={13} weight="fill" /> Stop
            </button>
          )}
        </article>
      )}

      <div className="results-toolbar">
        <p>
          {albumContext ? "Sources for " : "Results for "}
          <strong>
            {albumContext
              ? `${albumContext.title} by ${albumContext.artist}`
              : `“${search.query || "—"}”`}
          </strong>
          <span>
            {visibleCount}{" "}
            {showingAlbumSources
              ? visibleCount === 1
                ? "album source"
                : "album sources"
              : albumContext
                ? visibleCount === 1
                  ? "file"
                  : "files"
                : visibleCount === 1
                  ? "result"
                  : "results"}
          </span>
        </p>
        <div className="results-actions">
          {albumContext ? (
            <div className="album-result-view-switch" role="tablist" aria-label="Soulseek result view">
              <button
                type="button"
                role="tab"
                aria-selected={albumResultView === "sources"}
                className={albumResultView === "sources" ? "is-active" : ""}
                onClick={() => onAlbumResultViewChange("sources")}
              >
                <Disc size={14} /> Album sources
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={albumResultView === "files"}
                className={albumResultView === "files" ? "is-active" : ""}
                onClick={() => onAlbumResultViewChange("files")}
              >
                <ListBullets size={14} /> Individual files
              </button>
            </div>
          ) : null}
          <div className="sort-wrap">
            <button
              type="button"
              className="sort-button"
              disabled={results.length < 2}
              aria-expanded={sortOpen}
              onClick={() => {
                setSortOpen((open) => !open);
                setFilterOpen(false);
              }}
            >
              Sort: <strong>{sortLabels[sort]}</strong>{" "}
              <CaretDown size={12} weight="bold" />
            </button>
            {sortOpen && (
              <div className="sort-popover" role="menu">
                {(Object.keys(sortLabels) as SearchSort[]).map((value) => (
                  <button
                    type="button"
                    role="menuitem"
                    className={sort === value ? "is-active" : ""}
                    key={value}
                    onClick={() => {
                      onSortChange(value);
                      setSortOpen(false);
                    }}
                  >
                    {sortLabels[value]}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!showingAlbumSources ? <div className="view-toggle" aria-label="Results layout">
            <button
              type="button"
              className={layout === "list" ? "is-active" : ""}
              aria-label="List view"
              onClick={() => onLayoutChange("list")}
            >
              <ListBullets size={18} />
            </button>
            <button
              type="button"
              className={layout === "grid" ? "is-active" : ""}
              aria-label="Grid view"
              onClick={() => onLayoutChange("grid")}
            >
              <GridFour size={17} />
            </button>
          </div> : null}
        </div>
      </div>

      {showingAlbumSources ? (
        <AlbumSourceResults
          sources={visibleAlbumSources}
          transfers={transfers}
          searching={searching}
          onQueueAlbumSource={onQueueAlbumSource}
          onOpenTransfer={onOpenTransfer}
          onBrowseUser={onBrowseUser}
          personByUsername={personByUsername}
          onOpenPerson={onOpenPerson}
          smartPreferences={wantedAlbum?.preferences}
        />
      ) : <div className={`results-table ${layout === "grid" ? "is-grid" : ""}`}>
        <div className="result-header" aria-hidden="true">
          <span>Name</span>
          <span>User</span>
          <span>Quality</span>
          <span>Size</span>
          <span>Availability</span>
          <span />
        </div>

        <div className="result-list" ref={resultListRef} onScroll={(event) => scrollBySession.current.set(sessionId, event.currentTarget.scrollTop)} aria-live="polite">
          {visibleResults.length === 0 ? (
            <div className="empty-results">
              {searching ? (
                <CircleNotch className="search-spinner" size={28} />
              ) : (
                <MagnifyingGlass size={28} weight="light" />
              )}
              <h3>{searching ? "Listening for responses" : "No signals found"}</h3>
              <p>
                {searching
                  ? "Results will appear here as people respond."
                  : search.state === "idle"
                    ? "Search for an artist, album, track, or filename."
                    : "Try a broader artist, album, or track name."}
              </p>
            </div>
          ) : (
            visibleResults.map((result) => {
              const live = result.source === "live";
              const person = personByUsername(result.owner);
              return (
                <article
                  className={`result-row ${
                    selectedResult?.id === result.id ? "is-selected" : ""
                  }`}
                  key={result.id}
                >
                  <button
                    type="button"
                    className="result-select"
                    aria-label={`Select ${result.title} from ${result.owner}`}
                    onClick={() => onSelectResult(result)}
                  >
                    <span className="release-name">
                      {live ? (
                        <span className="file-format-art">{result.format.slice(0, 4)}</span>
                      ) : (
                        <img src="/assets/night-geometry-cover.png" alt="" />
                      )}
                      <span>
                        <strong>{result.title}</strong>
                        <small>{result.subtitle}</small>
                      </span>
                    </span>

                    <span className="source-user">
                      <strong><CountryFlag code={person?.countryCode} />{result.owner}</strong>
                      <small>
                        <ShieldCheck size={11} weight="fill" aria-hidden="true" />{" "}
                        {result.trust}% <em aria-label="Online" />
                      </small>
                    </span>

                    <span className="quality-cell">
                      <span className="format-row compact">
                        <span>{result.format}</span>
                        <span className="is-amber">{result.quality}</span>
                      </span>
                    </span>

                    <span className="result-size">
                      <strong>{result.size}</strong>
                      <small>
                        {live
                          ? result.isPrivate
                            ? "Private share"
                            : "Public share"
                          : `${result.tracks} tracks`}
                      </small>
                    </span>

                    <span className="availability-cell">
                      <Rating result={result} />
                      <AvailabilityBars values={result.availability} />
                    </span>
                  </button>

                  <span className="result-row-actions">
                    <button
                      type="button"
                      aria-label={`Browse files shared by ${result.owner}`}
                      title="Browse user shares"
                      onClick={() => onBrowseUser(result.owner)}
                    >
                      <FolderOpen size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`View ${result.owner}'s profile`}
                      title="View user profile"
                      onClick={() => onOpenPerson(result.owner)}
                    >
                      <UserCircle size={17} />
                    </button>
                    <button
                      type="button"
                      className="download-icon"
                      aria-label={
                        live
                          ? `Download ${result.title} from ${result.owner}`
                          : `Download ${result.title}`
                      }
                      title="Download file"
                      onClick={() => onQueueDownload(result)}
                    >
                      <DownloadSimple size={17} weight="bold" />
                    </button>
                  </span>
                </article>
              );
            })
          )}
        </div>
      </div>}
    </section>
  );
}
