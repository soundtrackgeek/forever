import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
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
  ShareDirectorySummary,
  ShareFolderSnapshot,
  ShareSearchSnapshot,
  UserSharesOverview,
} from "../types";

type ShareTreeNode = {
  path: string;
  name: string;
  directory: ShareDirectorySummary | null;
  children: ShareTreeNode[];
  fileCount: number;
  isPrivate: boolean;
};

type ShareTreeRow = {
  node: ShareTreeNode;
  depth: number;
  expanded: boolean;
};

const pathKey = (path: string) => path.toLocaleLowerCase();

const buildShareTree = (directories: ShareDirectorySummary[]) => {
  const nodes = new Map<string, ShareTreeNode>();
  const roots: ShareTreeNode[] = [];

  for (const directory of directories) {
    const segments = directory.path.split("\\").filter(Boolean);
    let parent: ShareTreeNode | null = null;
    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join("\\");
      const key = pathKey(path);
      let node = nodes.get(key);
      if (!node) {
        node = {
          path,
          name: segments[index],
          directory: null,
          children: [],
          fileCount: 0,
          isPrivate: directory.isPrivate,
        };
        nodes.set(key, node);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      if (index === segments.length - 1) {
        if (!node.directory || (node.directory.isPrivate && !directory.isPrivate)) {
          node.directory = directory;
        }
        node.isPrivate = node.isPrivate && directory.isPrivate;
      }
      parent = node;
    }
  }

  const finish = (node: ShareTreeNode): number => {
    node.children.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    const childFiles = node.children.reduce((total, child) => total + finish(child), 0);
    node.fileCount = (node.directory?.fileCount ?? 0) + childFiles;
    if (node.children.some((child) => !child.isPrivate)) node.isPrivate = false;
    return node.fileCount;
  };
  roots.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  roots.forEach(finish);
  return roots;
};

const flattenShareTree = (
  roots: ShareTreeNode[],
  activePath: string | null,
  matchedPaths: Set<string> | null,
  expandedPaths: Set<string>,
  collapsedPaths: Set<string>,
) => {
  const rows: ShareTreeRow[] = [];
  const activeKey = activePath ? pathKey(activePath) : null;
  const matchingBranches = matchedPaths ? new Set<string>() : null;

  const collectMatchingBranches = (node: ShareTreeNode): boolean => {
    const key = pathKey(node.path);
    const hasMatchingChild = node.children.some(collectMatchingBranches);
    if (!matchedPaths?.has(key) && !hasMatchingChild) return false;
    matchingBranches?.add(key);
    return true;
  };

  if (matchingBranches) roots.forEach(collectMatchingBranches);

  const append = (node: ShareTreeNode, depth: number) => {
    const key = pathKey(node.path);
    if (matchingBranches && !matchingBranches.has(key)) return;
    const followsActivePath = Boolean(
      activeKey && (activeKey === key || activeKey.startsWith(`${key}\\`)),
    );
    const expanded =
      node.children.length > 0 &&
      !collapsedPaths.has(key) &&
      (Boolean(matchedPaths) || expandedPaths.has(key) || followsActivePath);
    rows.push({ node, depth, expanded });
    if (expanded) node.children.forEach((child) => append(child, depth + 1));
  };

  roots.forEach((root) => append(root, 0));
  return rows;
};

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
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

  const shareTree = useMemo(
    () => buildShareTree(overview?.directories ?? []),
    [overview?.directories],
  );
  const matchedFolderPaths = useMemo(() => {
    if (!results?.query.trim()) return null;
    return new Set(results.directories.map((directory) => pathKey(directory.path)));
  }, [results]);
  const treeRows = useMemo(
    () =>
      flattenShareTree(
        shareTree,
        results ? null : folder?.directory ?? null,
        matchedFolderPaths,
        expandedPaths,
        collapsedPaths,
      ),
    [collapsedPaths, expandedPaths, folder?.directory, matchedFolderPaths, results, shareTree],
  );

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

  const toggleTreeNode = (row: ShareTreeRow) => {
    const key = pathKey(row.node.path);
    if (row.expanded) {
      setExpandedPaths((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setCollapsedPaths((current) => new Set(current).add(key));
    } else {
      setCollapsedPaths((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setExpandedPaths((current) => new Set(current).add(key));
    }
  };

  const openDirectory = (directory: ShareDirectorySummary) => {
    setQuery("");
    setExtension("all");
    onOpenFolder(directory.path);
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
            <small>{matchedFolderPaths ? results?.directories.length ?? 0 : overview?.directories.length ?? 0}</small>
          </div>
          {loading && !overview ? (
            <div className="shares-loading"><SpinnerGap className="is-spinning" size={22} /> Reading share list…</div>
          ) : (
            <div className="shares-tree-list">
              {treeRows.length === 0 ? (
                <div className="shares-tree-empty">No folders match “{results?.query}”.</div>
              ) : treeRows.map((row) => (
                <div
                  className={`shares-tree-row ${folder?.directory === row.node.directory?.path && !results ? "is-active" : ""}`}
                  style={{ paddingLeft: `${7 + Math.min(row.depth, 5) * 12}px` }}
                  key={row.node.path}
                >
                  {row.node.children.length ? (
                    <button
                      type="button"
                      className="shares-tree-toggle"
                      aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.node.name}`}
                      aria-expanded={row.expanded}
                      onClick={() => toggleTreeNode(row)}
                    >
                      <CaretRight className={row.expanded ? "is-expanded" : ""} size={11} weight="bold" />
                    </button>
                  ) : <span className="shares-tree-spacer" />}
                  <button
                    type="button"
                    className="shares-tree-folder"
                    onClick={() => row.node.directory ? openDirectory(row.node.directory) : toggleTreeNode(row)}
                    title={row.node.path}
                  >
                    {row.node.isPrivate ? <LockSimple size={14} /> : <FolderSimple size={15} />}
                    <span>{row.node.name}</span>
                    <small>{row.node.fileCount}</small>
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className={`shares-files ${results?.directories.length ? "has-folder-results" : ""}`}>
          <div className="shares-breadcrumb">
            <FolderOpen size={16} />
            <span>{results ? `${results.directories.length} ${results.directories.length === 1 ? "folder" : "folders"} · ${results.files.length} ${results.files.length === 1 ? "file" : "files"} for “${results.query || extension}”` : folder?.directory ?? "Select a folder"}</span>
            {results?.truncated && <small>First 500 matches</small>}
          </div>
          {Boolean(results?.directories.length) && (
            <div className="shares-folder-results" aria-label="Matching folders">
              <header><span>Matching folders</span><small>{results?.directories.length}</small></header>
              <div>
                {results?.directories.map((directory) => (
                  <button
                    type="button"
                    aria-label={`Open folder ${directory.path}`}
                    onClick={() => openDirectory(directory)}
                    key={`${directory.isPrivate}:${directory.path}`}
                  >
                    {directory.isPrivate ? <LockSimple size={16} /> : <FolderOpen size={16} />}
                    <span><strong>{directory.name}</strong><small>{directory.path}</small></span>
                    <em>{directory.fileCount} {directory.fileCount === 1 ? "file" : "files"}</em>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="shares-file-header" aria-hidden="true">
            <span /> <span>Name</span><span>Format</span><span>Quality</span><span>Duration</span><span>Size</span>
          </div>
          <div className="shares-file-list" aria-live="polite">
            {loading && visibleFiles.length === 0 ? (
              <div className="shares-empty"><SpinnerGap className="is-spinning" size={25} /><p>Listening for this user’s share list…</p></div>
            ) : visibleFiles.length === 0 ? (
              <div className="shares-empty"><FolderOpen size={28} /><p>{results?.directories.length ? "No files match. Choose a folder result above." : "No files or folders match this view."}</p></div>
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
