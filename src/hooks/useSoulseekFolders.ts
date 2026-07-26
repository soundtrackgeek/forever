import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import type { FolderFile, FolderInspection, SearchResult } from "../types";

const previewTracks = [
  ["01 - Thresholds.flac", 112_400_000, 321],
  ["02 - Hollow Planes.flac", 96_700_000, 307],
  ["03 - Vector Dreams.flac", 103_800_000, 378],
  ["04 - Night Geometry.flac", 98_200_000, 362],
  ["05 - Static Bloom.flac", 89_500_000, 276],
  ["06 - Liminal Structures.flac", 110_300_000, 431],
  ["07 - Phase Rotate.flac", 87_100_000, 342],
  ["08 - Afterglow.flac", 94_200_000, 299],
  ["09 - Silent Constellations.flac", 95_400_000, 267],
  ["10 - Return Vector.flac", 102_600_000, 238],
] as const;

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const previewInspection = (result: SearchResult): FolderInspection => {
  const folder = result.folder ?? "Music\\Liminal Structures\\Night Geometry";
  const smartMatchTrackSize = result.id.startsWith("wanted-") && result.sizeBytes
    ? Math.floor(result.sizeBytes / previewTracks.length)
    : null;
  return {
    token: 1,
    username: result.owner,
    requestedFolder: folder,
    receivedAtMs: Date.now(),
    files: [...previewTracks.map(([filename, sizeBytes, durationSeconds]): FolderFile => ({
      remoteFilename: `${folder}\\${filename}`,
      directory: folder,
      filename,
      sizeBytes: smartMatchTrackSize ?? sizeBytes,
      extension: "flac",
      bitrate: 2_304,
      durationSeconds,
      vbr: false,
      sampleRate: 96_000,
      bitDepth: 24,
    })),
      {
        remoteFilename: `${folder}\\cover.jpg`,
        directory: folder,
        filename: "cover.jpg",
        sizeBytes: 1_800_000,
        extension: "jpg",
        bitrate: null,
        durationSeconds: null,
        vbr: null,
        sampleRate: null,
        bitDepth: null,
      },
      {
        remoteFilename: `${folder}\\album.cue`,
        directory: folder,
        filename: "album.cue",
        sizeBytes: 12_000,
        extension: "cue",
        bitrate: null,
        durationSeconds: null,
        vbr: null,
        sampleRate: null,
        bitDepth: null,
      },
    ],
  };
};

export function useSoulseekFolders() {
  const native = isTauri();
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspect = useCallback(
    async (result: SearchResult) => {
      const folder = result.folder ?? (native ? "" : "Music\\Liminal Structures\\Night Geometry");
      if (!folder) {
        const message = "This search result does not include a source folder.";
        setError(message);
        throw new Error(message);
      }
      setLoading(true);
      setError(null);
      try {
        const next = native
          ? await invoke<FolderInspection>("folder_inspect", {
              username: result.owner,
              folder,
            })
          : previewInspection(result);
        setInspection(next);
        return next;
      } catch (cause) {
        const message = errorMessage(cause);
        setError(message);
        throw cause;
      } finally {
        setLoading(false);
      }
    },
    [native],
  );

  const clear = useCallback(() => {
    setInspection(null);
    setError(null);
    setLoading(false);
  }, []);

  return useMemo(
    () => ({ inspection, loading, error, inspect, clear }),
    [clear, error, inspect, inspection, loading],
  );
}
