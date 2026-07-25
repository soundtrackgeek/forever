import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import type {
  ShareDirectorySummary,
  ShareFile,
  ShareFolderSnapshot,
  ShareSearchSnapshot,
  UserSharesOverview,
} from "../types";

const previewDirectories = [
  "Music\\Electronic\\Liminal Structures\\Night Geometry",
  "Music\\Electronic\\Liminal Structures\\Signal Bloom",
  "Music\\Ambient\\Longform",
  "Music\\Jazz\\Spiritual Jazz",
  "Music\\Classical\\Modern",
  "Music\\Vinyl Rips\\Japanese pressings",
  "Bootlegs\\Live sets",
  "Books\\Music writing",
];

const previewTrackNames = [
  "01 - Thresholds.flac",
  "02 - Hollow Planes.flac",
  "03 - Vector Dreams.flac",
  "04 - Night Geometry.flac",
  "05 - Static Bloom.flac",
  "06 - Liminal Structures.flac",
  "07 - Phase Rotate.flac",
  "08 - Afterglow.flac",
  "09 - Silent Constellations.flac",
  "10 - Return Vector.flac",
];

const previewFiles = (directory: string): ShareFile[] => {
  const names = directory.endsWith("Night Geometry")
    ? previewTrackNames
    : ["01 - First signal.flac", "02 - Second signal.flac", "cover.jpg"];
  return names.map((filename, index) => {
    const filenameParts = filename.split(".");
    const extension = filenameParts[filenameParts.length - 1]?.toLowerCase() ?? "";
    return {
      remoteFilename: `${directory}\\${filename}`,
      directory,
      filename,
      sizeBytes: extension === "flac" ? 82_000_000 + index * 4_300_000 : 1_700_000,
      extension,
      bitrate: extension === "flac" ? 2_304 : null,
      durationSeconds: extension === "flac" ? 278 + index * 9 : null,
      vbr: false,
      sampleRate: extension === "flac" ? 96_000 : null,
      bitDepth: extension === "flac" ? 24 : null,
      isPrivate: false,
    };
  });
};

const previewFolder = (username: string, directory: string): ShareFolderSnapshot => {
  const files = previewFiles(directory);
  return {
    username,
    directory,
    isPrivate: false,
    files,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
};

const previewOverview = (username: string): UserSharesOverview => {
  const directories: ShareDirectorySummary[] = previewDirectories.map((path) => {
    const folder = previewFolder(username, path);
    const segments = path.split("\\");
    return {
      path,
      name: segments[segments.length - 1] ?? path,
      parent: segments.length > 1 ? segments.slice(0, -1).join("\\") : null,
      depth: segments.length,
      fileCount: folder.files.length,
      totalSizeBytes: folder.totalSizeBytes,
      isPrivate: false,
    };
  });
  return {
    username,
    directories,
    totalFileCount: directories.reduce((total, item) => total + item.fileCount, 0),
    totalSizeBytes: directories.reduce((total, item) => total + item.totalSizeBytes, 0),
    publicDirectoryCount: directories.length,
    privateDirectoryCount: 0,
    receivedAtMs: Date.now(),
  };
};

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function useSoulseekShares() {
  const native = isTauri();
  const [overview, setOverview] = useState<UserSharesOverview | null>(null);
  const [folder, setFolder] = useState<ShareFolderSnapshot | null>(null);
  const [results, setResults] = useState<ShareSearchSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFolder = useCallback(
    async (username: string, directory: string) => {
      setLoading(true);
      setError(null);
      try {
        const next = native
          ? await invoke<ShareFolderSnapshot>("shares_folder", { username, directory })
          : previewFolder(username, directory);
        setFolder(next);
        setResults(null);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setLoading(false);
      }
    },
    [native],
  );

  const browse = useCallback(
    async (username: string, refresh = false) => {
      setLoading(true);
      setError(null);
      setResults(null);
      try {
        const next = native
          ? await invoke<UserSharesOverview>("shares_browse", { username, refresh })
          : previewOverview(username);
        setOverview(next);
        const first =
          next.directories.find((directory) => /night geometry/i.test(directory.name)) ??
          next.directories.find((directory) => !directory.isPrivate);
        if (first) {
          const nextFolder = native
            ? await invoke<ShareFolderSnapshot>("shares_folder", {
                username: next.username,
                directory: first.path,
              })
            : previewFolder(next.username, first.path);
          setFolder(nextFolder);
        } else {
          setFolder(null);
        }
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setLoading(false);
      }
    },
    [native],
  );

  const search = useCallback(
    async (username: string, query: string, extension: string | null) => {
      setLoading(true);
      setError(null);
      try {
        let next: ShareSearchSnapshot;
        if (native) {
          next = await invoke<ShareSearchSnapshot>("shares_search", {
            username,
            query,
            extension,
          });
        } else {
          const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
          const directories = terms.length
            ? previewOverview(username).directories.filter((directory) => {
                const path = directory.path.toLowerCase();
                return terms.every((term) => path.includes(term));
              })
            : [];
          const files = previewDirectories
            .flatMap(previewFiles)
            .filter(
              (file) =>
                (!extension || file.extension === extension.toLowerCase()) &&
                terms.every((term) => file.remoteFilename.toLowerCase().includes(term)),
            );
          next = { username, query, extension, directories, files, truncated: false };
        }
        setResults(next);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setLoading(false);
      }
    },
    [native],
  );

  const clear = useCallback(() => {
    setOverview(null);
    setFolder(null);
    setResults(null);
    setError(null);
    setLoading(false);
  }, []);

  return useMemo(
    () => ({ overview, folder, results, loading, error, browse, openFolder, search, clear }),
    [browse, clear, error, folder, loading, openFolder, overview, results, search],
  );
}
