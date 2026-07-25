import {
  ArrowRight,
  CaretDown,
  DownloadSimple,
  FunnelSimple,
  GridFour,
  ListBullets,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Star,
  XCircle,
} from "@phosphor-icons/react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ConnectionSnapshot, SearchResult } from "../types";

type SearchWorkspaceProps = {
  query: string;
  submittedQuery: string;
  results: SearchResult[];
  selectedResult: SearchResult;
  connection: ConnectionSnapshot;
  onOpenConnection: () => void;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onSelectResult: (result: SearchResult) => void;
  onQueueDownload: (result: SearchResult) => void;
};

function AvailabilityBars({ values }: { values: number[] }) {
  return (
    <span className="availability-bars" aria-label="High availability">
      {values.map((value, index) => (
        <i key={`${value}-${index}`} style={{ height: `${value}%` }} />
      ))}
    </span>
  );
}

function Rating({ result }: { result: SearchResult }) {
  return (
    <span className="rating">
      <span aria-label={`${result.rating} out of 5 stars`}>
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

export function SearchWorkspace({
  query,
  submittedQuery,
  results,
  selectedResult,
  connection,
  onOpenConnection,
  onQueryChange,
  onSearch,
  onSelectResult,
  onQueueDownload,
}: SearchWorkspaceProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const online = connection.state === "online";
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
    const formData = new FormData(event.currentTarget);
    onSearch(String(formData.get("network-query") ?? ""));
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
            disabled={!online}
          >
            <MagnifyingGlass size={18} weight="light" />
          </button>
          <input
            name="network-query"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onSearch(event.currentTarget.value);
            }}
            aria-label="Search the network"
            placeholder="Search the network"
            disabled={!online}
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
              disabled={!online}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <FunnelSimple size={17} weight="light" />
            <span>All types</span>
            <CaretDown size={12} weight="bold" />
          </button>
          {filterOpen && (
            <div className="filter-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => setFilterOpen(false)}>
                All types <span>142</span>
              </button>
              <button type="button" role="menuitem" onClick={() => setFilterOpen(false)}>
                Lossless audio <span>96</span>
              </button>
              <button type="button" role="menuitem" onClick={() => setFilterOpen(false)}>
                Compressed audio <span>46</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <header className="workspace-heading">
        <h1>Across the network</h1>
        <p>Discover rare music shared by real people.</p>
      </header>

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
          <small>2019&nbsp;&nbsp;•&nbsp;&nbsp;10 tracks&nbsp;&nbsp;•&nbsp;&nbsp;53:21</small>
          <div className="format-row">
            <span>FLAC</span>
            <span className="is-amber">24 bit / 96 kHz</span>
            <span>VINYL RIP</span>
          </div>
          <p className="availability-note">
            <Star size={12} weight="fill" /> Very few copies available
          </p>
        </div>
        <AvailabilityBars values={selectedResult.availability} />
        <button
          type="button"
          className="view-release-button"
          onClick={() => onSelectResult(results[0] ?? selectedResult)}
        >
          View release <ArrowRight size={16} />
        </button>
      </article>

      <div className="results-toolbar">
        <p>
          Results for <strong>“{submittedQuery}”</strong>
          <span>{results.length === 0 ? 0 : 142} results</span>
        </p>
        <div className="results-actions">
          <button type="button" className="sort-button">
            Sort: <strong>Best match</strong> <CaretDown size={12} weight="bold" />
          </button>
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

        <div className="result-list">
          {results.length === 0 ? (
            <div className="empty-results">
              <MagnifyingGlass size={28} weight="light" />
              <h3>No signals found</h3>
              <p>Try a broader artist, album, or track name.</p>
            </div>
          ) : (
            results.map((result) => (
              <article
                className={`result-row ${
                  selectedResult.id === result.id ? "is-selected" : ""
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
                    <img src="/assets/night-geometry-cover.png" alt="" />
                    <span>
                      <strong>{result.title}</strong>
                      <small>{result.subtitle}</small>
                    </span>
                  </span>

                  <span className="source-user">
                    <strong>{result.owner}</strong>
                    <small>
                      <ShieldCheck size={11} weight="fill" aria-hidden="true" />{" "}
                      {result.trust}%{" "}
                      <em aria-label="Online" />
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
                    <small>{result.tracks} tracks</small>
                  </span>

                  <span className="availability-cell">
                    <Rating result={result} />
                    <AvailabilityBars values={result.availability} />
                  </span>
                </button>

                <span className="result-row-actions">
                  <button
                    type="button"
                    aria-label={`Add ${result.title} to queue`}
                    title="Add to queue"
                    onClick={() => onQueueDownload(result)}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    type="button"
                    className="download-icon"
                    aria-label={`Download ${result.title}`}
                    title="Download"
                    onClick={() => onQueueDownload(result)}
                  >
                    <DownloadSimple size={17} weight="bold" />
                  </button>
                </span>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
