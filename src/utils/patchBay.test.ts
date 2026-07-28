import { describe, expect, it } from "vitest";
import type { SearchResult, Transfer } from "../types";
import { buildPatchBayIssues } from "./patchBay";

const transfer = (overrides: Partial<Transfer> = {}): Transfer => ({
  id: "track-2",
  releaseId: "release-one",
  releaseTitle: "Signal Choir - Night Geometry (1994)",
  fileIndex: 2,
  fileCount: 2,
  expectedTrackCount: 3,
  title: "02 - Hollow Planes.flac",
  username: "original",
  remoteFilename: "Music\\Night Geometry\\02 - Hollow Planes.flac",
  sizeBytes: 50_000_000,
  transferredBytes: 50_000_000,
  speedBytesPerSecond: 0,
  etaSeconds: 0,
  status: "completed",
  queuePosition: null,
  localPath: "C:\\Forever\\02 - Hollow Planes.flac",
  error: null,
  verificationStatus: "verified",
  soundcheck: {
    status: "failed",
    checkedAtMs: 1,
    deep: true,
    codec: "FLAC",
    container: "FLAC",
    durationSeconds: 242,
    bitrateKbps: 920,
    sampleRate: 44_100,
    bitsPerSample: 16,
    channels: 2,
    trackNumber: 2,
    trackTotal: 3,
    issues: ["Decoder stopped before the final frame."],
  },
  createdAtMs: 1,
  updatedAtMs: 2,
  ...overrides,
});

const result = (filename: string, overrides: Partial<SearchResult> = {}): SearchResult => ({
  id: filename,
  title: filename,
  subtitle: "Night Geometry",
  owner: "repair-source",
  trust: 100,
  format: filename.split(".").pop() ?? "FLAC",
  quality: "Lossless",
  size: "51 MB",
  tracks: 3,
  rating: 5,
  ratingLabel: "Ready",
  availability: [],
  source: "live",
  filename: `Music\\Night Geometry\\${filename}`,
  folder: "Music\\Night Geometry",
  sizeBytes: 51_000_000,
  durationSeconds: 243,
  sampleRate: 44_100,
  bitDepth: 16,
  slotFree: true,
  ...overrides,
});

describe("Patch Bay planning", () => {
  it("ranks the matching track and adds an expected missing track", () => {
    const issues = buildPatchBayIssues(
      [transfer()],
      [result("02 - Hollow Planes.flac"), result("03 - Return Vector.flac")],
    );

    expect(issues.map((issue) => issue.trackNumber)).toEqual([1, 2, 3]);
    expect(issues[1].candidates[0].result.filename).toContain("02 - Hollow Planes.flac");
    expect(issues[1].candidates[0].confidence).toBe("strong");
    expect(issues[2].candidates[0].result.filename).toContain("03 - Return Vector.flac");
  });

  it("requires caution when a replacement changes format", () => {
    const [issue] = buildPatchBayIssues(
      [transfer()],
      [result("02 - Hollow Planes.mp3", { format: "MP3", bitrate: 320, bitDepth: null })],
    ).filter((candidate) => candidate.transferId === "track-2");

    expect(issue.candidates[0].sameFormat).toBe(false);
    expect(issue.candidates[0].warnings[0]).toContain("Format changes");
  });

  it("keeps a queued repair visible after Soundcheck evidence is cleared", () => {
    const issue = buildPatchBayIssues([
      transfer({
        status: "queued",
        soundcheck: null,
        verificationStatus: "pending",
        patchRepair: {
          reason: "The original decoder failed.",
          originalUsername: "original",
          originalRemoteFilename: "Music\\Night Geometry\\02 - Hollow Planes.flac",
          requestedAtMs: 3,
          repairedAtMs: null,
          warnings: [],
        },
      }),
    ], []).find((candidate) => candidate.transferId === "track-2")!;

    expect(issue.state).toBe("queued");
    expect(issue.reason).toContain("decoder failed");
  });
});
