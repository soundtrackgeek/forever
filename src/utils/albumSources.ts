import type { AlbumSource, SearchResult } from "../types";

const AUDIO_FORMATS = new Set([
  "AAC",
  "AIFF",
  "ALAC",
  "APE",
  "FLAC",
  "M4A",
  "MP3",
  "OGG",
  "OPUS",
  "WAV",
  "WMA",
  "WV",
]);

const filenameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const normalizedFolder = (folder: string) =>
  folder.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/\\$/, "");

const folderName = (folder: string) => {
  const segments = folder.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? folder;
};

const resultName = (result: SearchResult) => {
  const path = result.filename ?? result.title;
  return path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? path;
};

const sourceKey = (result: SearchResult) => {
  const folder = normalizedFolder(result.folder ?? "");
  return `${result.owner.toLocaleLowerCase()}\u0000${folder.toLocaleLowerCase() || result.id}`;
};

export const formatAlbumBytes = (bytes: number) => {
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

export function groupAlbumSources(results: SearchResult[]): AlbumSource[] {
  const sources = new Map<string, AlbumSource>();

  for (const result of results) {
    const key = sourceKey(result);
    const format = result.format.toUpperCase();
    const folder = normalizedFolder(result.folder ?? "") || "Shared folder unavailable";
    const existing = sources.get(key);

    if (!existing) {
      sources.set(key, {
        id: key,
        owner: result.owner,
        folder,
        folderName: folderName(folder),
        files: [result],
        tracks: AUDIO_FORMATS.has(format) ? [result] : [],
        formats: AUDIO_FORMATS.has(format) ? [format] : [],
        qualities: result.quality ? [result.quality] : [],
        totalSizeBytes: result.sizeBytes ?? 0,
        slotFree: Boolean(result.slotFree),
        averageSpeed: result.averageSpeed ?? 0,
        queueLength: result.queueLength ?? 0,
        isPrivate: Boolean(result.isPrivate),
        representative: result,
      });
      continue;
    }

    existing.files.push(result);
    existing.totalSizeBytes += result.sizeBytes ?? 0;
    existing.slotFree ||= Boolean(result.slotFree);
    existing.averageSpeed = Math.max(existing.averageSpeed, result.averageSpeed ?? 0);
    existing.queueLength = Math.min(existing.queueLength, result.queueLength ?? 0);
    existing.isPrivate ||= Boolean(result.isPrivate);
    if (AUDIO_FORMATS.has(format)) {
      existing.tracks.push(result);
      if (!existing.formats.includes(format)) existing.formats.push(format);
    }
    if (result.quality && !existing.qualities.includes(result.quality)) {
      existing.qualities.push(result.quality);
    }
  }

  for (const source of sources.values()) {
    source.files.sort((left, right) =>
      filenameCollator.compare(resultName(left), resultName(right)),
    );
    source.tracks.sort((left, right) =>
      filenameCollator.compare(resultName(left), resultName(right)),
    );
  }

  return Array.from(sources.values());
}

export function albumSourcesMeetingTrackMinimum(
  sources: AlbumSource[],
  minimumTrackCount: number | null | undefined,
) {
  if (!minimumTrackCount || minimumTrackCount < 1) return sources;
  return sources.filter((source) => source.tracks.length >= minimumTrackCount);
}
