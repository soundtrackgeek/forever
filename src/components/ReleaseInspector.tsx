import {
  ArrowLeft,
  Check,
  DotsThree,
  DownloadSimple,
  FileAudio,
  FolderOpen,
  PushPin,
  ShieldCheck,
  SpinnerGap,
  WarningCircle,
  Waves,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { FolderFile, FolderInspection, SearchResult } from "../types";

type ReleaseInspectorProps = {
  result: SearchResult | null;
  inspection: FolderInspection | null;
  folderLoading: boolean;
  folderError: string | null;
  onInspectFolder: (result: SearchResult) => void;
  onQueueDownload: (result: SearchResult) => void;
  onQueueRelease: (
    result: SearchResult,
    title: string,
    inspection: FolderInspection,
    files: FolderFile[],
  ) => void;
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

const folderTitle = (path?: string) =>
  path?.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "Selected folder";

const qualityLabel = (file: FolderFile) => {
  if (file.bitDepth && file.sampleRate) {
    return `${file.bitDepth}/${Math.round(file.sampleRate / 1_000)}`;
  }
  if (file.bitrate) return `${file.bitrate} kbps`;
  return file.extension.toUpperCase() || "FILE";
};

const speedLabel = (bytesPerSecond?: number) => {
  if (!bytesPerSecond) return "Not reported";
  const megabytes = bytesPerSecond / 1_000_000;
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB/s`;
};

export function ReleaseInspector({
  result,
  inspection,
  folderLoading,
  folderError,
  onInspectFolder,
  onQueueDownload,
  onQueueRelease,
}: ReleaseInspectorProps) {
  const [selection, setSelection] = useState<{
    token: number | null;
    files: Set<string>;
  }>({ token: null, files: new Set() });
  const live = result?.source === "live";
  const inspectedForResult =
    inspection &&
    result &&
    inspection.username.toLocaleLowerCase() === result.owner.toLocaleLowerCase() &&
    inspection.requestedFolder.toLocaleLowerCase() ===
      (result.folder ?? "Music\\Liminal Structures\\Night Geometry").toLocaleLowerCase()
      ? inspection
      : null;

  const selectedFiles = useMemo(
    () =>
      inspectedForResult && selection.token === inspectedForResult.token
        ? selection.files
        : new Set(
            inspectedForResult?.files.map((file) => file.remoteFilename) ?? [],
          ),
    [inspectedForResult, selection],
  );

  const chosenFiles = useMemo(
    () =>
      inspectedForResult?.files.filter((file) =>
        selectedFiles.has(file.remoteFilename),
      ) ?? [],
    [inspectedForResult, selectedFiles],
  );
  const selectedBytes = chosenFiles.reduce(
    (total, file) => total + file.sizeBytes,
    0,
  );

  return (
    <aside className="release-inspector" aria-label="Selected result">
      <header className="inspector-header">
        <span>
          <ArrowLeft size={15} /> {inspectedForResult ? "Folder contents" : live ? "Selected file" : "Selected release"}
        </span>
        <span className="inspector-header-actions">
          <button type="button" aria-label="Pin result" title="Pin">
            <PushPin size={15} />
          </button>
          <button type="button" aria-label="More result actions" title="More">
            <DotsThree size={19} weight="bold" />
          </button>
        </span>
      </header>

      {!result ? (
        <div className="inspector-empty">
          <Waves size={30} weight="light" />
          <h2>Waiting for a signal</h2>
          <p>Select a result to inspect its file and source details.</p>
        </div>
      ) : inspectedForResult ? (
        <>
          <div className="inspector-scroll folder-inspector">
            <div className="folder-release-heading">
              <span className="folder-release-art">
                <FolderOpen size={34} weight="thin" />
              </span>
              <span>
                <small>From {result.owner}</small>
                <h2>{folderTitle(inspectedForResult.requestedFolder)}</h2>
                <p title={inspectedForResult.requestedFolder}>
                  {inspectedForResult.requestedFolder}
                </p>
              </span>
            </div>

            <div className="folder-selection-toolbar">
              <span>
                <strong>{chosenFiles.length}</strong> of {inspectedForResult.files.length} selected
                <small>{formatBytes(selectedBytes)}</small>
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelection({
                    token: inspectedForResult.token,
                    files:
                      selectedFiles.size === inspectedForResult.files.length
                        ? new Set()
                        : new Set(
                            inspectedForResult.files.map(
                              (file) => file.remoteFilename,
                            ),
                          ),
                  })
                }
              >
                {selectedFiles.size === inspectedForResult.files.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
            </div>

            <ol className="folder-file-list">
              {inspectedForResult.files.map((file, index) => {
                const selected = selectedFiles.has(file.remoteFilename);
                return (
                  <li className={selected ? "is-selected" : ""} key={file.remoteFilename}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${selected ? "Deselect" : "Select"} ${file.filename}`}
                      onClick={() =>
                        setSelection(() => {
                          const next = new Set(selectedFiles);
                          if (next.has(file.remoteFilename)) {
                            next.delete(file.remoteFilename);
                          } else {
                            next.add(file.remoteFilename);
                          }
                          return { token: inspectedForResult.token, files: next };
                        })
                      }
                    >
                      <i aria-hidden="true">{selected && <Check size={10} weight="bold" />}</i>
                      <span className="folder-file-index">{index + 1}</span>
                      <span className="folder-file-copy">
                        <strong>{file.filename}</strong>
                        <small>{file.extension.toUpperCase()} · {qualityLabel(file)}</small>
                      </span>
                      <small>{formatBytes(file.sizeBytes)}</small>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <footer className="inspector-actions folder-download-actions">
            <button
              type="button"
              className="primary-action"
              disabled={chosenFiles.length === 0}
              onClick={() =>
                onQueueRelease(
                  result,
                  folderTitle(inspectedForResult.requestedFolder),
                  inspectedForResult,
                  chosenFiles,
                )
              }
            >
              <DownloadSimple size={18} weight="bold" /> Download {chosenFiles.length} {chosenFiles.length === 1 ? "file" : "files"}
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className={`inspector-scroll ${live ? "live-file-inspector" : ""}`}>
            {live ? (
              <div className="live-file-art">
                <FileAudio size={54} weight="thin" />
                <span>{result.format}</span>
              </div>
            ) : (
              <img
                className="inspector-art"
                src="/assets/night-geometry-cover.png"
                alt="Night Geometry cover: a violet moon behind a dark monolith"
              />
            )}

            <div className="inspector-release-copy">
              <h2>{live ? result.title : result.title.replace(/ \(.*\)/, "")}</h2>
              <p>{result.folder ?? "Liminal Structures"}</p>
              <div className="format-row">
                <span>{result.format}</span>
                <span className="is-amber">{result.quality}</span>
                {result.vbr && <span>VBR</span>}
              </div>
            </div>

            {live && (
              <section className="file-facts">
                <span><small>File size</small><strong>{result.size}</strong></span>
                <span><small>Source speed</small><strong>{speedLabel(result.averageSpeed)}</strong></span>
                <span><small>Queue</small><strong>{result.slotFree ? "Slot ready" : `${result.queueLength ?? 0} waiting`}</strong></span>
                <span><small>Visibility</small><strong>{result.isPrivate ? "Private share" : "Public share"}</strong></span>
              </section>
            )}

            <section className="source-profile">
              {live ? (
                <span className="source-avatar">{result.owner.slice(0, 1).toUpperCase()}</span>
              ) : (
                <img src="/assets/listener-avatar.png" alt="" />
              )}
              <span>
                <strong>{result.owner}</strong>
                <small><ShieldCheck size={11} weight="fill" aria-hidden="true" /> {live ? "Live Soulseek response" : `${result.trust}% · 2,341 shares`}</small>
                <small><i aria-hidden="true" /> Online now</small>
              </span>
            </section>

            {folderError && (
              <div className="folder-inspect-error" role="alert">
                <WarningCircle size={15} weight="fill" />
                <span>{folderError}</span>
              </div>
            )}
          </div>
          <footer className="inspector-actions inspector-download-options">
            <button
              type="button"
              className="primary-action"
              disabled={folderLoading}
              onClick={() => onInspectFolder(result)}
            >
              {folderLoading ? (
                <SpinnerGap className="is-spinning" size={18} />
              ) : (
                <FolderOpen size={18} weight="bold" />
              )}
              {folderLoading ? "Reading folder…" : "Browse folder"}
            </button>
            {live && (
              <button
                type="button"
                className="secondary-action"
                aria-label={`Download ${result.title} only`}
                title="Download this file only"
                onClick={() => onQueueDownload(result)}
              >
                <DownloadSimple size={18} />
              </button>
            )}
          </footer>
        </>
      )}
    </aside>
  );
}
