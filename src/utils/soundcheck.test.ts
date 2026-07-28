import { describe, expect, it } from "vitest";
import type { SoundcheckResult, Transfer } from "../types";
import { summarizeSoundcheck } from "./soundcheck";

const result = (trackNumber: number, status: SoundcheckResult["status"] = "passed"): SoundcheckResult => ({
  status,
  checkedAtMs: 1,
  deep: false,
  codec: "MP3",
  container: "MP3",
  durationSeconds: 180,
  bitrateKbps: 320,
  sampleRate: 44_100,
  bitsPerSample: null,
  channels: 2,
  trackNumber,
  trackTotal: 2,
  issues: [],
});

const transfer = (trackNumber: number, soundcheck = result(trackNumber)): Transfer => ({
  id: String(trackNumber),
  releaseId: "release",
  expectedTrackCount: 2,
  title: `${trackNumber}.mp3`,
  username: "listener",
  remoteFilename: `${trackNumber}.mp3`,
  sizeBytes: 10,
  transferredBytes: 10,
  speedBytesPerSecond: 0,
  etaSeconds: 0,
  status: "completed",
  queuePosition: null,
  localPath: `${trackNumber}.mp3`,
  error: null,
  verificationStatus: "verified",
  soundcheck,
  createdAtMs: 1,
  updatedAtMs: 1,
});

describe("summarizeSoundcheck", () => {
  it("passes a complete, readable release", () => {
    expect(summarizeSoundcheck([transfer(1), transfer(2)]).state).toBe("passed");
  });

  it("fails a release with an expected track missing", () => {
    const summary = summarizeSoundcheck([transfer(1)]);
    expect(summary.state).toBe("failed");
    expect(summary.issues[0]).toContain("Expected 2");
  });

  it("keeps unsupported codecs visible for review", () => {
    expect(summarizeSoundcheck([transfer(1, result(1, "unsupported")), transfer(2)]).state).toBe("review");
  });
});
