import { describe, expect, it } from "vitest";
import type { Transfer } from "../types";
import { releaseHealth } from "./finishLine";
import { groupTransfers } from "./transfers";

const transfer = (
  id: string,
  status: Transfer["status"],
  overrides: Partial<Transfer> = {},
): Transfer => ({
  id,
  releaseId: "finish-line-release",
  releaseTitle: "Finish Line",
  releaseFolder: "C:\\Downloads\\Finish Line",
  fileIndex: Number(id),
  fileCount: 3,
  title: `${id}.flac`,
  username: "first-source",
  remoteFilename: `Music\\Finish Line\\${id}.flac`,
  sizeBytes: 100,
  transferredBytes: status === "completed" ? 100 : 20,
  speedBytesPerSecond: 0,
  etaSeconds: null,
  status,
  queuePosition: null,
  localPath: `C:\\Downloads\\Finish Line\\${id}.flac`,
  error: null,
  createdAtMs: Number(id),
  updatedAtMs: Number(id),
  ...overrides,
});

describe("Finish Line release health", () => {
  it("distinguishes verified, missing, and recovering files", () => {
    const group = groupTransfers([
      transfer("1", "completed", { verificationStatus: "verified" }),
      transfer("2", "completed", { verificationStatus: "missing" }),
      transfer("3", "retrying", { retryCount: 2, retryAtMs: 30_000 }),
    ])[0];

    expect(releaseHealth(group)).toMatchObject({
      state: "attention",
      completedCount: 2,
      verifiedCount: 1,
      missingCount: 1,
      recoveringCount: 1,
      nextRetryAtMs: 30_000,
    });
  });

  it("treats a fully absent completed release as moved rather than damaged", () => {
    const group = groupTransfers([
      transfer("1", "completed", { verificationStatus: "missing" }),
      transfer("2", "completed", { verificationStatus: "missing" }),
      transfer("3", "completed", { verificationStatus: "missing" }),
    ])[0];

    expect(releaseHealth(group)).toMatchObject({
      state: "moved",
      completedCount: 3,
      missingCount: 3,
      mismatchCount: 0,
      failedCount: 0,
    });
  });

  it("treats missing audio as filed away when Archive owns the album", () => {
    const group = groupTransfers([
      transfer("1", "completed", {
        remoteFilename: "Music\\Finish Line\\01.mp3",
        verificationStatus: "missing",
      }),
      transfer("2", "completed", {
        remoteFilename: "Music\\Finish Line\\01.lrc",
        verificationStatus: "verified",
      }),
      transfer("3", "completed", {
        remoteFilename: "Music\\Finish Line\\cover.jpg",
        verificationStatus: "verified",
      }),
    ])[0];

    expect(releaseHealth(group)).toMatchObject({
      state: "attention",
      filedByArchive: false,
      verifiedCount: 2,
      missingCount: 1,
    });
    expect(releaseHealth(group, { archiveOwned: true })).toMatchObject({
      state: "moved",
      filedByArchive: true,
      verifiedCount: 2,
      missingCount: 1,
    });
  });

  it("deduplicates persisted alternative sources across release files", () => {
    const alternative = {
      username: "backup-source",
      remoteFolder: "Music\\Finish Line [FLAC]",
      files: [{ title: "1.flac", remoteFilename: "Music\\Finish Line [FLAC]\\1.flac", sizeBytes: 100 }],
    };
    const group = groupTransfers([
      transfer("1", "completed", { verificationStatus: "verified", alternativeSources: [alternative] }),
      transfer("2", "queued", { alternativeSources: [alternative] }),
    ])[0];

    expect(releaseHealth(group).alternatives).toEqual([alternative]);
  });
});
