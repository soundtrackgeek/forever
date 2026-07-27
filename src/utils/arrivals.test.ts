import { describe, expect, it } from "vitest";
import type { Transfer } from "../types";
import { arrivalForGroup } from "./arrivals";
import { groupTransfers } from "./transfers";

const transfer = (
  id: string,
  verificationStatus: Transfer["verificationStatus"],
  filedAtMs: number | null = null,
): Transfer => ({
  id,
  releaseId: "arrival-release",
  releaseTitle: "Signal Choir - After Midnight (2026)",
  releaseFolder: "C:\\Downloads\\After Midnight",
  fileIndex: Number(id),
  fileCount: 2,
  title: `${id}.flac`,
  username: "listener",
  remoteFilename: `Music\\After Midnight\\${id}.flac`,
  sizeBytes: 100,
  transferredBytes: 100,
  speedBytesPerSecond: 0,
  etaSeconds: 0,
  status: "completed",
  queuePosition: null,
  localPath: `C:\\Downloads\\After Midnight\\${id}.flac`,
  error: null,
  verificationStatus,
  verifiedAtMs: 1,
  filedAtMs,
  createdAtMs: 1,
  updatedAtMs: 2,
});

const arrival = (transfers: Transfer[], archiveOwned = false) =>
  arrivalForGroup(groupTransfers(transfers)[0], archiveOwned);

describe("Arrival Desk lifecycle", () => {
  it("keeps verified downloads ready to file", () => {
    expect(arrival([transfer("1", "verified"), transfer("2", "verified")])?.state)
      .toBe("ready");
  });

  it("recognizes Archive ownership without moving or writing files", () => {
    const result = arrival([transfer("1", "missing"), transfer("2", "missing")], true);
    expect(result?.state).toBe("filed");
    expect(result?.archiveOwned).toBe(true);
  });

  it("treats an entirely departed audio release as moved rather than corrupt", () => {
    expect(arrival([transfer("1", "missing"), transfer("2", "missing")])?.state)
      .toBe("moved");
  });

  it("respects a persisted manual filing confirmation", () => {
    const result = arrival([
      transfer("1", "verified", 42),
      transfer("2", "verified", 42),
    ]);
    expect(result?.state).toBe("filed");
    expect(result?.manuallyFiled).toBe(true);
    expect(result?.filedAtMs).toBe(42);
  });
});
