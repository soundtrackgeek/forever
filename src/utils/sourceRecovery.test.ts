import { describe, expect, it } from "vitest";
import type { ReleaseAlternativeSource, SourceReliability, Transfer } from "../types";
import { exactMirror, flakySource, reliabilityScore, stalledForRecovery } from "./sourceRecovery";
import { groupTransfers } from "./transfers";

export const waiting: Transfer = {
  id: "one", releaseId: "album", title: "One", username: "original", remoteFilename: "album/01.flac",
  localPath: "01.flac", sizeBytes: 1000, transferredBytes: 200, speedBytesPerSecond: 0, etaSeconds: null,
  status: "remotelyQueued", waitingSinceMs: 1, queuePosition: 3, error: null, createdAtMs: 1, updatedAtMs: 1,
};
export const mirror: ReleaseAlternativeSource = { username: "mirror", remoteFolder: "other", files: [
  { title: "01.flac", remoteFilename: "other/01.flac", sizeBytes: 1000 },
] };
export const memory: SourceReliability = { successes: 2, failures: 4, denials: 2, starts: 3, typicalStartDelayMs: 60_000, typicalSpeed: 100, updatedAtMs: 1 };

describe("source recovery", () => {
  it("requires opt-in, elapsed wait and excludes paused, downloading and exhausted releases", () => {
    expect(stalledForRecovery([waiting], 0, 600_001)).toBe(false);
    expect(stalledForRecovery([waiting], 10, 600_000)).toBe(false);
    expect(stalledForRecovery([waiting], 10, 600_001)).toBe(true);
    for (const status of ["paused", "downloading"] as const) expect(stalledForRecovery([{ ...waiting, status }], 5, 600_001)).toBe(false);
    expect(stalledForRecovery([{ ...waiting, automaticSources: ["a", "b", "c", "d"] }], 5, 600_001)).toBe(false);
  });
  it("requires unique exact coverage and never returns to an old source", () => {
    expect(exactMirror([waiting], mirror)).toBe(true);
    expect(exactMirror([waiting], { ...mirror, files: [{ ...mirror.files[0], sizeBytes: 999 }] })).toBe(false);
    expect(exactMirror([waiting], { ...mirror, files: [...mirror.files, ...mirror.files] })).toBe(false);
    expect(exactMirror([waiting, { ...waiting, id: "two" }], mirror)).toBe(false);
    expect(exactMirror([{ ...waiting, automaticSources: ["MIRROR"] }], mirror)).toBe(false);
    expect(exactMirror([{ ...waiting, status: "completed" }], mirror)).toBe(false);
  });
  it("requires repeated failures for a flaky badge and adjusts source ranking", () => {
    expect(flakySource(memory)).toBe(true);
    expect(flakySource({ ...memory, failures: 2 })).toBe(false);
    expect(flakySource(undefined)).toBe(false);
    expect(reliabilityScore(memory)).toBeLessThan(reliabilityScore());
    expect(reliabilityScore({ ...memory, successes: 8, failures: 0, denials: 0 })).toBeGreaterThan(reliabilityScore());
  });
  it("adds observed wait scaled by queue position, otherwise leaves ETA unknown", () => {
    const group = groupTransfers([waiting], { original: memory }, 30_001)[0];
    expect(group.etaSeconds).toBe(158); // 3 * 60 - 30 seconds waiting + 800 / 100 bytes
    expect(group.etaIncludesQueue).toBe(true);
    expect(groupTransfers([waiting], {}, 30_001)[0].etaSeconds).toBeNull();
    expect(groupTransfers([waiting], { original: { ...memory, starts: 1 } }, 30_001)[0].etaSeconds).toBeNull();
    expect(groupTransfers([{ ...waiting, status: "downloading", speedBytesPerSecond: 200 }], { original: memory })[0].etaSeconds).toBe(4);
  });
});
