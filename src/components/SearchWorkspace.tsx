import {
  ArrowRight,
  CaretDown,
  CircleNotch,
  DownloadSimple,
  FunnelSimple,
  GridFour,
  ListBullets,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Star,
  Stop,
  XCircle,
} from "@phosphor-icons/react";
import {
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  ConnectionSnapshot,
  SearchResult,
  SearchSnapshot,
} from "../types";

type Filter = "all" | "lossless" | "compressed";
type Sort = "best" | "ready" | "fast" | "small";

type SearchWorkspaceProps = {
  query: string;
  results: SearchResult[];
  selectedResult: SearchResult | null;
  search: SearchSnapshot;
  searchError: string | null;
  connection: ConnectionSnapshot;
  onOpenConnection: () => void;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onStopSearch: () => void;
  onSelectResult: (result: SearchResult) => void;
  onQueueDownload: (result: SearchResult) => void;
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

const filterLabels: Record<Filter, string> = {
  all: "All types",
  lossless: "Lossless audio",
  compressed: "Compressed audio",
};

const sortLabels: Record<Sort, string> = {
  best: "Best match",
  ready: "Ready first",
  fast: "Fastest first",
  small: "Smallest first",
};

export function SearchWorkspace({
  query,
  results,
  selectedResult,
  search,
  searchError,
  connection,
  onOpenConnection,
  onQueryChange,
  onSearch,
  onStopSearch,
  onSelectResult,
  onQueueDownload,
}: SearchWorkspaceProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("best");
  const [sortOpen, setSortOpen] = useState(false);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const online = connection.state === "online";
  const searching = search.state === "searching";
  const preview = search.message.startsWith("Preview data");
  const losslessCount = results.filter((result) =>
    losslessFormats.has(result.format),
  ).length;
  const compressedCount = results.filter((result) =>
    compressedFormats.has(result.format),
  ).length;

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
    <section className="search-workspace" aria-label="Search workspace">
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
                  ["all", results.length],
                  ["lossless", losslessCount],
                  ["compressed", compressedCount],
                ] as const
              ).map(([value, count]) => (
                <button
                  type="button"
                  role="menuitem"
                  className={filter === value ? "is-active" : ""}
                  key={value}
                  onClick={() => {
                    setFilter(value);
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

      <header className="workspace-heading">
        <h1>Across the network</h1>
        <p>Discover rare music shared by real people.</p>
      </header>

      {preview && search.query === "night geometry" ? (
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
        <article className={`live-search-card is-${search.state}`}>
          <span className="live-search-signal" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            <span className="eyebrow">
              {searching ? "Live signal" : "Search report"}
            </span>
            <h2>{search.query ? `“${search.query}”` : "Ready to listen"}</h2>
            <p>{searchError ?? search.message}</p>
          </div>
          <dl>
            <div>
              <dt>Files</dt>
              <dd>{search.resultCount}</dd>
            </div>
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
          Results for <strong>“{search.query || "—"}”</strong>
          <span>
            {visibleResults.length} {visibleResults.length === 1 ? "result" : "results"}
          </span>
        </p>
        <div className="results-actions">
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
                {(Object.keys(sortLabels) as Sort[]).map((value) => (
                  <button
                    type="button"
                    role="menuitem"
                    className={sort === value ? "is-active" : ""}
                    key={value}
                    onClick={() => {
                      setSort(value);
                      setSortOpen(false);
                    }}
                  >
                    {sortLabels[value]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="view-toggle" aria-label="Results layout">
            <button
              type="button"
              className={layout === "list" ? "is-active" : ""}
              aria-label="List view"
              onClick={() => setLayout("list")}
            >
              <ListBullets size={18} />
            </button>
            <button
              type="button"
              className={layout === "grid" ? "is-active" : ""}
              aria-label="Grid view"
              onClick={() => setLayout("grid")}
            >
              <GridFour size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className={`results-table ${layout === "grid" ? "is-grid" : ""}`}>
        <div className="result-header" aria-hidden="true">
          <span>Name</span>
          <span>User</span>
          <span>Quality</span>
          <span>Size</span>
          <span>Availability</span>
          <span />
        </div>

        <div className="result-list" aria-live="polite">
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
                      <strong>{result.owner}</strong>
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
                      aria-label={
                        live
                          ? "Downloads arrive in version 0.0.5"
                          : `Add ${result.title} to queue`
                      }
                      title={live ? "Downloads arrive in 0.0.5" : "Add to queue"}
                      disabled={live}
                      onClick={() => onQueueDownload(result)}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      type="button"
                      className="download-icon"
                      aria-label={
                        live
                          ? "Downloads arrive in version 0.0.5"
                          : `Download ${result.title}`
                      }
                      title={live ? "Downloads arrive in 0.0.5" : "Download"}
                      disabled={live}
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
      </div>
    </section>
  );
}
