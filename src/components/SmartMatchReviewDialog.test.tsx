import { beforeAll, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SmartMatchReviewDialog } from "./SmartMatchReviewDialog";
import type { AlbumTrack, FolderInspection, WantedAlbum } from "../types";

vi.mock("../utils/matchingClient", async () => {
  const { runMatching } = await import("../../scripts/matching-runtime.mjs");
  return { matchingCommand: runMatching };
});
beforeAll(async () => {
  const { prepareMatchingRuntime } = await import("../../scripts/matching-runtime.mjs");
  await prepareMatchingRuntime();
}, 120_000);
const album = { albumId: "album", title: "Album", artist: "Artist",
  preferences: { formatPreference: "any", minimumBitrateKbps: null, minimumTrackCount: null },
} as WantedAlbum;
const tracks: AlbumTrack[] = [{ position: 1, discNumber: 1, discPosition: 1, title: "Song", durationMs: 180000 }];
const inspection = { files: [{ remoteFilename: "Album\\01 Song.flac", filename: "01 Song.flac",
  extension: "flac", sizeBytes: 100, durationSeconds: 90 }] } as FolderInspection;
const props = {
  album, inspection, officialTracks: tracks, tracklistState: "ready" as const,
  loading: false, error: null, queued: false, onConfirm: vi.fn(), onRetry: vi.fn(),
  onCompare: vi.fn(), onClose: vi.fn(),
  onLoadEditions: async () => ({ releases: [], defaultReleaseId: null, truncated: false }),
  onSelectEdition: vi.fn(),
};
it("blocks a truncated recording and rechecks lengths when the chosen edition changes", async () => {
  const { rerender } = render(<SmartMatchReviewDialog {...props} />);
  await screen.findByText("1 duration mismatch", {}, { timeout: 10000 });
  expect(screen.getByText("Length differs (-90s)")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Queue complete album" })).not.toBeInTheDocument();
  rerender(<SmartMatchReviewDialog {...props} officialTracks={[{ ...tracks[0], durationMs: 90000 }]} />);
  const queue = await screen.findByRole("button", { name: "Queue complete album" });
  await waitFor(() => expect(queue).toBeEnabled(), { timeout: 10000 });
  expect(screen.getByText("Length agrees (0s)")).toBeInTheDocument();
  fireEvent.click(queue);
  expect(props.onConfirm).toHaveBeenCalledOnce();
});
it("does not recommend a saved edition when its tracklist cannot be loaded", async () => {
  render(<SmartMatchReviewDialog {...props} album={{ ...album, selectedReleaseId: "saved" }}
    officialTracks={[]} tracklistState="unavailable" />);
  await screen.findByText("Track-count fallback");
  expect(screen.queryByRole("button", { name: "Queue complete album" })).not.toBeInTheDocument();
});
