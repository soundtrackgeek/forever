import {
  Archive,
  ArrowsClockwise,
  CheckCircle,
  Database,
  Disc,
  LockKey,
  MusicNotes,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ArchiveStatus } from "../types";

type ArchiveWorkspaceProps = {
  status: ArchiveStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<ArchiveStatus>;
};

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

export function ArchiveWorkspace({
  status,
  loading,
  error,
  onRefresh,
}: ArchiveWorkspaceProps) {
  const connected = Boolean(status?.connected);
  return (
    <section className="archive-workspace" aria-label="Archive">
      <header className="archive-heading">
        <div>
          <span className="archive-heading-mark"><Archive size={21} weight="light" /></span>
          <span>
            <h1>Your collection, without touching it.</h1>
            <p>Forever reads Music Library as the source of truth. Downloads stay entirely separate.</p>
          </span>
        </div>
        <button
          type="button"
          className="archive-refresh"
          disabled={loading}
          onClick={() => void onRefresh().catch(() => undefined)}
        >
          <ArrowsClockwise className={loading ? "is-spinning" : ""} size={16} />
          {loading ? "Checking…" : "Refresh Archive"}
        </button>
      </header>

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
          <span><h2>Ownership follows your real library</h2><p>Album discovery is checked against the normalized albums table, including artist, title, year, and track count.</p></span>
        </article>
        <article>
          <Archive size={22} weight="light" />
          <span><h2>Forever downloads remain separate</h2><p>Nothing downloaded from Soulseek is added to Archive. Your configured Forever download folder remains independent.</p></span>
        </article>
      </div>
    </section>
  );
}
