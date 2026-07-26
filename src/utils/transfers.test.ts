import { describe, expect, it } from "vitest";
import type { Transfer } from "../types";
import { groupTransfers, summarizeTransferGroups } from "./transfers";

const transfer = (
  id: string,
  releaseId: string,
  status: Transfer["status"],
  overrides: Partial<Transfer> = {},
): Transfer => ({
  id,
  releaseId,
  releaseTitle: releaseId,
  releaseFolder: `Music\\${releaseId}`,
  fileIndex: 1,
  fileCount: 1,
  title: `${id}.flac`,
  username: `source-${releaseId}`,
  remoteFilename: `Music\\${releaseId}\\${id}.flac`,
  sizeBytes: 1_000,
  transferredBytes: 0,
  speedBytesPerSecond: 0,
  etaSeconds: null,
  status,
  queuePosition: null,
  localPath: "",
  error: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  ...overrides,
});

describe("transfer signal order", () => {
  it("keeps queued releases in the persisted backend order and numbers them", () => {
    const groups = groupTransfers([
      transfer("active-track", "active-release", "downloading"),
      transfer("later-track", "later-release", "queued"),
      transfer("next-track", "next-release", "queued"),
    ]);

    expect(groups.map((group) => group.releaseId)).toEqual([
      "active-release",
      "later-release",
      "next-release",
    ]);
    expect(groups.map((group) => group.queuePosition)).toEqual([null, 1, 2]);
  });

  it("summarizes every unfinished release with one queue-wide ETA", () => {
    const groups = groupTransfers([
      transfer("active-a", "active-release", "completed", {
        sizeBytes: 1_000,
        transferredBytes: 1_000,
      }),
      transfer("active-b", "active-release", "downloading", {
        fileIndex: 2,
        sizeBytes: 5_000,
        transferredBytes: 1_000,
        speedBytesPerSecond: 1_000,
      }),
      transfer("queued-a", "queued-release", "queued", {
        sizeBytes: 6_000,
      }),
      transfer("done-a", "done-release", "completed", {
        sizeBytes: 20_000,
        transferredBytes: 20_000,
      }),
    ]);

    expect(summarizeTransferGroups(groups)).toEqual({
      releaseCount: 2,
      fileCount: 2,
      remainingBytes: 10_000,
      speedBytesPerSecond: 1_000,
      etaSeconds: 10,
    });
  });
});
