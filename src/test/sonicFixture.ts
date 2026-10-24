import type { SonicEvidence } from "../types";

// Synthetic signal evidence used only by UI tests.
export const sonicFixture: SonicEvidence = {
  version: 1, verdict: "suspectTranscode", analyzedSeconds: 4, sampleRate: 48_000,
  windows: 16, activeWindows: 16, cutoffHz: 16_000, cutoffConsistency: 1,
  energyAboveCutoffDb: -63, paddedBitDepth: false, clippedSamples: 0, clippingRuns: 0,
  spectrogram: btoa(String.fromCharCode(...Array.from({ length: 16 * 64 }, (_, n) => n % 64 < 42 ? 70 : 0))),
  columnSeconds: 0.25,
};
