import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchResults as previewResults } from "../data/mockData";
import type {
  LiveSearchResult,
  SearchEvent,
  SearchResult,
  SearchSnapshot,
} from "../types";

const PREVIEW_QUERY = "night geometry";

const previewSnapshot = (): SearchSnapshot => ({
  state: "completed",
  token: 1,
  query: PREVIEW_QUERY,
  resultCount: previewResults.length,
  peerCount: previewResults.length,
  message: "Preview data — connect in the desktop app for live network results.",
  startedAtMs: Date.now() - 900,
  finishedAtMs: Date.now(),
});

const idleSnapshot: SearchSnapshot = {
  state: "idle",
  token: null,
  query: "",
  resultCount: 0,
  peerCount: 0,
  message: "Ready for a live search.",
  startedAtMs: null,
  finishedAtMs: null,
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

const basename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? path;

export const remoteDirectory = (path: string) => {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separator >= 0 ? path.slice(0, separator) : "";
};

const displayDirectory = (path: string) =>
  remoteDirectory(path).replace(/[\\/]/g, " / ") || "Shared file";

const formatDuration = (seconds: number | null) => {
  if (!seconds) return null;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const formatQuality = (result: LiveSearchResult) => {
  if (result.bitDepth && result.sampleRate) {
    const kilohertz = result.sampleRate / 1_000;
    return `${result.bitDepth} / ${Number.isInteger(kilohertz) ? kilohertz : kilohertz.toFixed(1)}`;
  }
  if (result.bitrate) return `${result.bitrate} kbps${result.vbr ? " VBR" : ""}`;
  return "Details unavailable";
};

const barsFor = (result: LiveSearchResult) => {
  const strength = result.slotFree
    ? 48
    : Math.max(14, 40 - Math.min(result.queueLength, 25));
  return Array.from({ length: 16 }, (_, index) =>
    Math.max(8, strength + ((index * 13 + result.username.length * 7) % 18) - 9),
  );
};

const presentResult = (result: LiveSearchResult): SearchResult => {
  const title = basename(result.filename);
  const duration = formatDuration(result.durationSeconds);
  return {
    id: result.id,
    title,
    subtitle: `${displayDirectory(result.filename)}${duration ? ` · ${duration}` : ""}`,
    owner: result.username,
    trust: result.slotFree ? 100 : Math.max(70, 98 - result.queueLength),
    format: (
      result.extension ||
      title.split(".").slice(-1)[0] ||
      "FILE"
    ).toUpperCase(),
    quality: formatQuality(result),
    size: formatBytes(result.sizeBytes),
    tracks: 1,
    rating: result.slotFree ? 5 : result.queueLength < 5 ? 4 : 3,
    ratingLabel: result.slotFree ? "Ready" : `${result.queueLength} queued`,
    availability: barsFor(result),
    source: "live",
    filename: result.filename,
    folder: remoteDirectory(result.filename),
    sizeBytes: result.sizeBytes,
    bitrate: result.bitrate,
    durationSeconds: result.durationSeconds,
    vbr: result.vbr,
    sampleRate: result.sampleRate,
    bitDepth: result.bitDepth,
    slotFree: result.slotFree,
    averageSpeed: result.averageSpeed,
    queueLength: result.queueLength,
    isPrivate: result.isPrivate,
  };
};

type PreviewAlbumSource = {
  id: string;
  username: string;
  folder: string;
  tracks: string[];
  format: "flac" | "mp3";
  slotFree: boolean;
  averageSpeed: number;
  queueLength: number;
};

const previewAlbumSource = (source: PreviewAlbumSource) => [
  ...source.tracks.map((track, index) => {
    const extension = source.format;
    return presentResult({
      id: `${source.id}-${index + 1}`,
      token: 2,
      username: source.username,
      filename: `${source.folder}\\${String(index + 1).padStart(2, "0")} - ${track}.${extension}`,
      sizeBytes:
        extension === "mp3" ? 9_400_000 + index * 170_000 : 38_000_000 + index * 2_300_000,
      extension,
      bitrate: extension === "mp3" ? 320 : 1_411,
      durationSeconds: 245 + ((index * 31) % 155),
      vbr: false,
      sampleRate: 44_100,
      bitDepth: extension === "flac" ? 16 : null,
      slotFree: source.slotFree,
      averageSpeed: source.averageSpeed,
      queueLength: source.queueLength,
      isPrivate: false,
    });
  }),
  presentResult({
    id: `${source.id}-cover`,
    token: 2,
    username: source.username,
    filename: `${source.folder}\\cover.jpg`,
    sizeBytes: 1_800_000,
    extension: "jpg",
    bitrate: null,
    durationSeconds: null,
    vbr: null,
    sampleRate: null,
    bitDepth: null,
    slotFree: source.slotFree,
    averageSpeed: source.averageSpeed,
    queueLength: source.queueLength,
    isPrivate: false,
  }),
];

const nightGeometryTracks = [
  "Thresholds",
  "Hollow Planes",
  "Vector Dreams",
  "Night Geometry",
  "Static Bloom",
  "Liminal Structures",
  "Phase Rotate",
  "Afterglow",
  "Silent Constellations",
  "Return Vector",
];

const hysteriaTracks = [
  "Women",
  "Rocket",
  "Animal",
  "Love Bites",
  "Pour Some Sugar on Me",
  "Armageddon It",
  "Gods of War",
  "Don't Shoot Shotgun",
  "Run Riot",
  "Hysteria",
  "Excitable",
  "Love and Affection",
];

const previewNetworkResults = [
  ...previewAlbumSource({ id: "night-flac", username: "audiophile92", folder: "Music\\Liminal Structures\\Night Geometry [FLAC]", tracks: nightGeometryTracks, format: "flac", slotFree: true, averageSpeed: 8_200_000, queueLength: 0 }),
  ...previewAlbumSource({ id: "night-mp3", username: "soulseeker7", folder: "Music\\Liminal Structures\\Night Geometry (2019) [320]", tracks: nightGeometryTracks, format: "mp3", slotFree: false, averageSpeed: 5_100_000, queueLength: 3 }),
  ...previewAlbumSource({ id: "hysteria-flac", username: "bleachjt", folder: "Music\\Def Leppard\\1987 - Hysteria [FLAC]", tracks: hysteriaTracks, format: "flac", slotFree: true, averageSpeed: 9_400_000, queueLength: 0 }),
  ...previewAlbumSource({ id: "hysteria-mp3", username: "rockarchive", folder: "Music\\Def Leppard\\Hysteria (1987) [320]", tracks: hysteriaTracks, format: "mp3", slotFree: true, averageSpeed: 6_800_000, queueLength: 0 }),
  ...previewAlbumSource({ id: "hysteria-mfsl", username: "vinylrips", folder: "Music\\Rock\\Def Leppard\\Hysteria MFSL", tracks: hysteriaTracks, format: "flac", slotFree: false, averageSpeed: 3_700_000, queueLength: 4 }),
];

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function useSoulseekSearch() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<SearchSnapshot>(
    native ? idleSnapshot : previewSnapshot(),
  );
  const [results, setResults] = useState<SearchResult[]>(
    native ? [] : previewResults,
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);
  const previewGeneration = useRef(0);
  const timers = useRef<number[]>([]);

  const clearPreviewTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<SearchEvent>("forever://search", (event) => {
      if (!mounted) return;
      setSnapshot(event.payload.snapshot);
      if (event.payload.event === "started") {
        setResults([]);
        setError(null);
      } else if (event.payload.results.length > 0) {
        setResults((current) => [
          ...current,
          ...event.payload.results.map(presentResult),
        ]);
      } else if (event.payload.event === "error") {
        setError(event.payload.snapshot.message);
      }
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });

    void invoke<SearchSnapshot>("search_snapshot")
      .then((next) => {
        if (mounted) setSnapshot(next);
      })
      .catch((cause) => {
        if (mounted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [native]);

  useEffect(() => clearPreviewTimers, [clearPreviewTimers]);

  const startSearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query) throw new Error("Enter something to search for.");
      setError(null);

      if (native) {
        try {
          const next = await invoke<SearchSnapshot>("search_start", { query });
          setSnapshot(next);
          setResults([]);
          return next;
        } catch (cause) {
          const message = errorMessage(cause);
          setError(message);
          setSnapshot((current) => ({
            ...current,
            state: "error",
            query,
            message,
            finishedAtMs: Date.now(),
          }));
          throw cause;
        }
      }

      clearPreviewTimers();
      const generation = ++previewGeneration.current;
      const started: SearchSnapshot = {
        state: "searching",
        token: generation + 1,
        query,
        resultCount: 0,
        peerCount: 0,
        message: "Listening across the Soulseek network…",
        startedAtMs: Date.now(),
        finishedAtMs: null,
      };
      setSnapshot(started);
      setResults([]);

      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = previewNetworkResults.filter((result) =>
        terms.every((term) =>
          `${result.title} ${result.subtitle} ${result.owner} ${result.format}`
            .toLowerCase()
            .includes(term),
        ),
      );
      const matchingPeople = new Set(matches.map((result) => result.owner)).size;
      const firstBatch = matches.slice(0, 3);
      const secondBatch = matches.slice(3);

      const streamBatch = (batch: SearchResult[], total: number) => {
        if (previewGeneration.current !== generation) return;
        setResults((current) => [...current, ...batch]);
        setSnapshot((current) => ({
          ...current,
          resultCount: total,
          peerCount: matchingPeople,
          message: `Receiving files from ${matchingPeople} ${matchingPeople === 1 ? "person" : "people"}…`,
        }));
      };

      timers.current.push(
        window.setTimeout(() => streamBatch(firstBatch, firstBatch.length), 260),
        window.setTimeout(
          () => streamBatch(secondBatch, matches.length),
          580,
        ),
        window.setTimeout(() => {
          if (previewGeneration.current !== generation) return;
          setSnapshot((current) => ({
            ...current,
            state: "completed",
            resultCount: matches.length,
            peerCount: matchingPeople,
            message:
              matches.length === 0
                ? "No matching files arrived."
                : `Found ${matches.length} files from ${matchingPeople} ${matchingPeople === 1 ? "person" : "people"}.`,
            finishedAtMs: Date.now(),
          }));
        }, 820),
      );
      return started;
    },
    [clearPreviewTimers, native],
  );

  const stopSearch = useCallback(async () => {
    if (native) {
      const next = await invoke<SearchSnapshot>("search_stop");
      setSnapshot(next);
      return next;
    }
    clearPreviewTimers();
    previewGeneration.current += 1;
    const stopped = {
      ...snapshot,
      state: "stopped" as const,
      message: "Search stopped.",
      finishedAtMs: Date.now(),
    };
    setSnapshot(stopped);
    return stopped;
  }, [clearPreviewTimers, native, snapshot]);

  return {
    ready,
    snapshot,
    results,
    error,
    startSearch,
    stopSearch,
  };
}
