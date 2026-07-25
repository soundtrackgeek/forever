import {
  ArrowClockwise,
  CaretDown,
  Check,
  DownloadSimple,
  FileAudio,
  FileImage,
  FileText,
  FolderOpen,
  FolderSimple,
  LockSimple,
  MagnifyingGlass,
  ShieldCheck,
  SpinnerGap,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  FolderFile,
  ShareFile,
  ShareFolderSnapshot,
  ShareSearchSnapshot,
  UserSharesOverview,
} from "../types";

type UserSharesWorkspaceProps = {
  username: string;
  overview: UserSharesOverview | null;
  folder: ShareFolderSnapshot | null;
  results: ShareSearchSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenFolder: (directory: string) => void;
  onSearch: (query: string, extension: string | null) => void;
  onDownload: (title: string, remoteFolder: string, files: FolderFile[]) => void;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1_000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_000;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_000; index += 1) {
    value /= 1_000;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
};

const formatDuration = (seconds: number | null) => {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const titleFromPath = (path: string) => {
  const parts = path.split("\\").filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

const FileIcon = ({ extension }: { extension: string }) => {
  if (["jpg", "jpeg", "png", "webp"].includes(extension)) return <FileImage size={17} />;
  if (["txt", "log", "nfo", "pdf"].includes(extension)) return <FileText size={17} />;
  return <FileAudio size={17} />;
};

export function UserSharesWorkspace({
  username,
  overview,
  folder,
  results,
  loading,
  error,
  onRefresh,
  onOpenFolder,
  onSearch,
  onDownload,
}: UserSharesWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [extension, setExtension] = useState("all");
  const [sort, setSort] = useState<"name" | "size" | "format">("name");
  const [selection, setSelection] = useState<Map<string, ShareFile>>(new Map());

  const visibleFiles = useMemo(() => {
    const files = [...(results?.files ?? folder?.files ?? [])];
    files.sort((left, right) => {
      if (sort === "size") return right.sizeBytes - left.sizeBytes;
      if (sort === "format") return left.extension.localeCompare(right.extension);
      return left.filename.localeCompare(right.filename, undefined, { numeric: true });
    });
    return files;
  }, [folder?.files, results?.files, sort]);

  const selectedFiles = [...selection.values()];
  const selectedBytes = selectedFiles.reduce((total, file) => total + file.sizeBytes, 0);
  const currentPublicFiles = (folder?.files ?? []).filter((file) => !file.isPrivate);
  const currentAllSelected =
    currentPublicFiles.length > 0 &&
    currentPublicFiles.every((file) => selection.has(file.remoteFilename));

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    onSearch(query.trim(), extension === "all" ? null : extension);
  };

  const toggleFile = (file: ShareFile) => {
    if (file.isPrivate) return;
    setSelection((current) => {
      const next = new Map(current);
      if (next.has(file.remoteFilename)) next.delete(file.remoteFilename);
      else next.set(file.remoteFilename, file);
      return next;
    });
  };

  const toggleFolder = () => {
    setSelection((current) => {
      const next = new Map(current);
      for (const file of currentPublicFiles) {
        if (currentAllSelected) next.delete(file.remoteFilename);
        else next.set(file.remoteFilename, file);
      }
      return next;
    });
  };

  return (
    <section className="shares-workspace" aria-label={`${username}'s shared files`}>
      <header className="shares-heading">
        <div>
          <span className="shares-kicker"><UserCircle size={15} /> User shares</span>
          <h1>{username}’s shares</h1>
          <p><i aria-hidden="true" /> Online · Shared directly from this listener</p>
        </div>
        <button type="button" className="shares-refresh" onClick={onRefresh} disabled={loading}>
          <ArrowClockwise className={loading ? "is-spinning" : ""} size={16} /> Refresh
        </button>
      </header>

      <form className="shares-toolbar" onSubmit={submitSearch}>
        <MagnifyingGlass size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this user's shares"
          aria-label="Search this user's shares"
        />
        <label>
          <span className="sr-only">Format</span>
          <select
            value={extension}
            onChange={(event) => {
              setExtension(event.target.value);
              if (query.trim() || event.target.value !== "all") {
                onSearch(query.trim(), event.target.value === "all" ? null : event.target.value);
              }
            }}
          >
            <option value="all">All formats</option>
            <option value="flac">FLAC</option>
            <option value="mp3">MP3</option>
            <option value="m4a">M4A</option>
            <option value="wav">WAV</option>
          </select>
          <CaretDown size={11} />
        </label>
        <label>
          <span className="sr-only">Sort files</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="name">Name</option>
            <option value="size">Largest</option>
            <option value="format">Format</option>
          </select>
          <CaretDown size={11} />
        </label>
        <button type="submit" className="shares-search-button">Search</button>
      </form>

      {error && (
        <div className="shares-error" role="alert">
          <WarningCircle size={17} weight="fill" />
          <span><strong>Couldn’t read these shares.</strong>{error}</span>
          <button type="button" onClick={onRefresh}>Try again</button>
        </div>
      )}

      <div className="shares-browser">
        <aside className="shares-tree" aria-label="Shared folders">
          <div className="shares-pane-title">
            <span>Folders</span>
            <small>{overview?.directories.length ?? 0}</small>
          </div>
          {loading && !overview ? (
            <div className="shares-loading"><SpinnerGap className="is-spinning" size={22} /> Reading share list…</div>
          ) : (
            <div className="shares-tree-list">
              {overview?.directories.map((directory) => (
                <button
                  type="button"
                  className={folder?.directory === directory.path && !results ? "is-active" : ""}
                  style={{ paddingLeft: `${14 + Math.min(directory.depth - 1, 4) * 11}px` }}
                  onClick={() => {
                    setQuery("");
                    setExtension("all");
                    onOpenFolder(directory.path);
                  }}
                  title={directory.path}
                  key={`${directory.isPrivate}:${directory.path}`}
                >
                  {directory.isPrivate ? <LockSimple size={14} /> : <FolderSimple size={15} />}
                  <span>{directory.name}</span>
                  <small>{directory.fileCount}</small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="shares-files">
          <div className="shares-breadcrumb">
            <FolderOpen size={16} />
            <span>{results ? `Results for “${results.query || extension}”` : folder?.directory ?? "Select a folder"}</span>
            {results?.truncated && <small>First 500 matches</small>}
          </div>
          <div className="shares-file-header" aria-hidden="true">
            <span /> <span>Name</span><span>Format</span><span>Quality</span><span>Duration</span><span>Size</span>
          </div>
          <div className="shares-file-list" aria-live="polite">
            {loading && visibleFiles.length === 0 ? (
              <div className="shares-empty"><SpinnerGap className="is-spinning" size={25} /><p>Listening for this user’s share list…</p></div>
            ) : visibleFiles.length === 0 ? (
              <div className="shares-empty"><FolderOpen size={28} /><p>No files match this view.</p></div>
            ) : visibleFiles.map((file) => {
              const selected = selection.has(file.remoteFilename);
              return (
                <button
                  type="button"
                  className={`shares-file-row ${selected ? "is-selected" : ""}`}
                  aria-pressed={selected}
                  aria-label={`${selected ? "Deselect" : "Select"} ${file.filename}`}
                  disabled={file.isPrivate}
                  onClick={() => toggleFile(file)}
                  key={file.remoteFilename}
                >
                  <i className="share-check">{selected && <Check size={10} weight="bold" />}</i>
                  <span className="share-file-name"><FileIcon extension={file.extension} /><span><strong>{file.filename}</strong><small>{file.directory}</small></span></span>
                  <span className="share-format">{file.extension.toUpperCase() || "FILE"}</span>
                  <span>{file.bitDepth && file.sampleRate ? `${file.bitDepth} / ${file.sampleRate / 1_000}` : file.bitrate ? `${file.bitrate}k` : "—"}</span>
                  <span>{formatDuration(file.durationSeconds)}</span>
                  <span>{formatBytes(file.sizeBytes)}</span>
                </button>
              );
            })}
          </div>
        </main>

        <aside className="shares-inspector">
          <section className="share-user-card">
            <span className="share-avatar">{username.slice(0, 1).toUpperCase()}</span>
            <div><strong>{username}</strong><small><i /> Online now</small><small><ShieldCheck size={11} weight="fill" /> Soulseek listener</small></div>
          </section>
          <section className="share-summary">
            <span><small>Shared files</small><strong>{overview?.totalFileCount.toLocaleString() ?? "—"}</strong></span>
            <span><small>Total size</small><strong>{overview ? formatBytes(overview.totalSizeBytes) : "—"}</strong></span>
            <span><small>Folders</small><strong>{overview?.publicDirectoryCount ?? "—"}</strong></span>
          </section>
          <section className="share-selection">
            <span className="shares-pane-title">Selection</span>
            <div className="selection-orbit"><strong>{selectedFiles.length}</strong><small>files</small></div>
            <h2>{selectedFiles.length ? `${selectedFiles.length} files selected` : "Choose your files"}</h2>
            <p>{selectedFiles.length ? `${formatBytes(selectedBytes)} across ${new Set(selectedFiles.map((file) => file.directory)).size} folder${new Set(selectedFiles.map((file) => file.directory)).size === 1 ? "" : "s"}` : "Select tracks or take a complete folder."}</p>
            <button type="button" className="select-folder-button" onClick={toggleFolder} disabled={!currentPublicFiles.length}>
              <FolderOpen size={16} /> {currentAllSelected ? "Deselect folder" : "Select folder"}
            </button>
          </section>
          <button
            type="button"
            className="shares-download"
            disabled={!selectedFiles.length}
            onClick={() => onDownload(
              selectedFiles.length === currentPublicFiles.length && folder
                ? titleFromPath(folder.directory)
                : `${username} selection`,
              folder?.directory ?? `${username} shares`,
              selectedFiles,
            )}
          >
            <DownloadSimple size={18} weight="bold" /> Download selection
          </button>
          <small className="share-cache-note">Share lists stay in memory for this session only.</small>
        </aside>
      </div>
    </section>
  );
}
