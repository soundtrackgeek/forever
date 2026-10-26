import type { SmartDownloadSettings } from "../settings";
import type { FolderInspection, Transfer, WantedAlbum, WantedBestSource, WantedSmartState } from "../types";
import { groupTransfers } from "../utils/transfers";

export const smartSettings: SmartDownloadSettings = {
  enabled: true,
  stallMinutes: 20,
  maxAttempts: 3,
  maxActiveAlbums: 2,
  durationToleranceSeconds: 3,
  allowedLengthMismatches: 0,
};

export const MINUTE = 60_000;
export const T0 = 1_000_000_000_000;

export const source = (username: string, folder = "Music\\Unveiled"): WantedBestSource => ({
  username,
  folder,
  format: "FLAC",
  trackCount: 2,
  sizeBytes: 20_000_000,
  slotFree: true,
  averageSpeedBytesPerSecond: 1_000_000,
  queueLength: 0,
  minimumBitrateKbps: null,
  score: 1_000,
  tracklistLabel: "Exact tracklist",
  folders: [folder],
});

export const smartState = (overrides: Partial<WantedSmartState> = {}): WantedSmartState => ({
  attempts: 0,
  tried: [],
  current: null,
  resumeAtMs: null,
  lastRecheckAtMs: null,
  message: null,
  updatedAtMs: 0,
  ...overrides,
});

export const wantedAlbum = (overrides: Partial<WantedAlbum> = {}): WantedAlbum => ({
  albumId: "release-group-unveiled",
  artist: "Whitecross",
  title: "Unveiled",
  firstReleaseDate: "1994-01-01",
  coverArtUrl: null,
  paused: false,
  fulfilled: false,
  fulfilledAtMs: null,
  fulfillmentSource: null,
  downloadReceipt: null,
  ownedTrackCount: null,
  preferences: { formatPreference: "preferLossless", minimumBitrateKbps: 320, minimumTrackCount: null },
  addedAtMs: T0 - 60 * MINUTE,
  lastCheckedAtMs: T0 - 5 * MINUTE,
  sourceCount: 3,
  matchingSourceCount: 3,
  readySourceCount: 2,
  completeSourceCount: 3,
  newSourceCount: 0,
  bestFormat: "FLAC",
  bestTrackCount: 2,
  bestSizeBytes: 20_000_000,
  bestSpeedBytesPerSecond: 1_000_000,
  bestSource: source("alice"),
  candidates: [source("alice"), source("bob"), source("carol")],
  autoDownload: true,
  smart: smartState(),
  error: null,
  ...overrides,
});

type ReleaseOptions = {
  releaseId?: string;
  username?: string;
  status?: Transfer["status"];
  verification?: Transfer["verificationStatus"];
  soundcheck?: "passed" | "failed" | "review" | null;
  transferredBytes?: number;
  albumId?: string | null;
  createdAtMs?: number;
  files?: number;
};

/** A two-track release, shaped like what the transfer queue reports. */
export const releaseTransfers = (options: ReleaseOptions = {}): Transfer[] => {
  const {
    releaseId = "release-1",
    username = "alice",
    status = "downloading",
    verification = status === "completed" ? "verified" : "pending",
    soundcheck = status === "completed" ? "passed" : null,
    transferredBytes = status === "completed" ? 10_000_000 : 0,
    albumId = "release-group-unveiled",
    createdAtMs = T0 - 10 * MINUTE,
    files = 2,
  } = options;
  return Array.from({ length: files }, (_, offset) => {
    const index = offset + 1;
    return {
      id: `${releaseId}-${index}`,
      releaseId,
      releaseTitle: "Whitecross - Unveiled (1994)",
      releaseFolder: "C:\\Downloads\\Whitecross - Unveiled (1994)",
      releaseGroupId: albumId,
      fileIndex: index,
      fileCount: files,
      expectedTrackCount: files,
      title: `0${index} - Track.flac`,
      username,
      remoteFilename: `Music\\Unveiled\\0${index} - Track.flac`,
      sizeBytes: 10_000_000,
      transferredBytes,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      status,
      queuePosition: null,
      localPath: `C:\\Downloads\\Whitecross\\0${index} - Track.flac`,
      error: null,
      verificationStatus: verification,
      verifiedAtMs: verification === "verified" ? T0 : null,
      soundcheck: soundcheck
        ? {
            status: soundcheck,
            checkedAtMs: T0,
            deep: false,
            codec: "FLAC",
            container: "FLAC",
            durationSeconds: 240,
            bitrateKbps: null,
            sampleRate: 44_100,
            bitsPerSample: 16,
            channels: 2,
            trackNumber: index,
            trackTotal: files,
            issues: soundcheck === "failed" ? ["Damaged frame"] : [],
          }
        : null,
      createdAtMs,
      updatedAtMs: createdAtMs,
    } satisfies Transfer;
  });
};

export const groupsOf = (...releases: Transfer[][]) => groupTransfers(releases.flat());

export const inspection = (username = "alice", tracks = 2): FolderInspection => ({
  token: 1,
  username,
  requestedFolder: "Music\\Unveiled",
  receivedAtMs: T0,
  files: [
    ...Array.from({ length: tracks }, (_, offset) => ({
      remoteFilename: `Music\\Unveiled\\0${offset + 1} - Track.flac`,
      directory: "Music\\Unveiled",
      filename: `0${offset + 1} - Track.flac`,
      sizeBytes: 10_000_000,
      extension: "flac",
      bitrate: null,
      durationSeconds: 240,
      vbr: null,
      sampleRate: 44_100,
      bitDepth: 16,
    })),
    {
      remoteFilename: "Music\\Unveiled\\cover.jpg",
      directory: "Music\\Unveiled",
      filename: "cover.jpg",
      sizeBytes: 100_000,
      extension: "jpg",
      bitrate: null,
      durationSeconds: null,
      vbr: null,
      sampleRate: null,
      bitDepth: null,
    },
  ],
});
