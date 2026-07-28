import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SearchSessionRecord } from "../hooks/useSoulseekSearch";
import type { SearchResult, Transfer } from "../types";
import { groupTransfers } from "../utils/transfers";
import { ArrivalDesk } from "./ArrivalDesk";

const brokenTransfer: Transfer = {
  id: "broken-track",
  releaseId: "release-patch-bay",
  releaseTitle: "Signal Choir - Night Geometry (1994)",
  releaseFolder: "C:\\Forever\\Signal Choir - Night Geometry (1994)",
  fileIndex: 2,
  fileCount: 1,
  expectedTrackCount: 1,
  title: "02 - Hollow Planes.flac",
  username: "original-source",
  remoteFilename: "Music\\Night Geometry\\02 - Hollow Planes.flac",
  sizeBytes: 50_000_000,
  transferredBytes: 50_000_000,
  speedBytesPerSecond: 0,
  etaSeconds: 0,
  status: "completed",
  queuePosition: null,
  localPath: "C:\\Forever\\Signal Choir - Night Geometry (1994)\\02 - Hollow Planes.flac",
  error: null,
  verificationStatus: "verified",
  verifiedAtMs: 10,
  soundcheck: {
    status: "failed",
    checkedAtMs: 11,
    deep: true,
    codec: "FLAC",
    container: "FLAC",
    durationSeconds: 242,
    bitrateKbps: 920,
    sampleRate: 44_100,
    bitsPerSample: 16,
    channels: 2,
    trackNumber: 2,
    trackTotal: 2,
    issues: ["Decoder stopped before the final frame."],
  },
  createdAtMs: 1,
  updatedAtMs: 12,
};

const replacement: SearchResult = {
  id: "replacement-track",
  title: "02 - Hollow Planes.flac",
  subtitle: "Night Geometry",
  owner: "repair-source",
  trust: 100,
  format: "FLAC",
  quality: "Lossless",
  size: "51 MB",
  tracks: 2,
  rating: 5,
  ratingLabel: "Ready",
  availability: [],
  source: "live",
  filename: "Music\\Night Geometry [FLAC]\\02 - Hollow Planes.flac",
  folder: "Music\\Night Geometry [FLAC]",
  sizeBytes: 51_000_000,
  durationSeconds: 243,
  sampleRate: 44_100,
  bitDepth: 16,
  slotFree: true,
  averageSpeed: 8_000_000,
  queueLength: 0,
};

const relayRecord: SearchSessionRecord = {
  snapshot: {
    state: "completed",
    token: 9,
    clientId: "signal-relay:release-patch-bay",
    query: "Signal Choir - Night Geometry (1994)",
    resultCount: 1,
    peerCount: 1,
    message: "Search complete",
    startedAtMs: 1,
    finishedAtMs: 2,
  },
  results: [replacement],
  error: null,
  unseenCount: 0,
};

const resolved = vi.fn(async () => undefined);

describe("Arrival Desk Patch Bay", () => {
  it("opens a ranked per-track repair and queues only the selected candidate", async () => {
    const onPatchReleaseFile = vi.fn(async () => undefined);
    render(<ArrivalDesk
      groups={groupTransfers([brokenTransfer])}
      archiveOwnedReleaseIds={new Set()}
      refreshing={false}
      onRefreshArchive={resolved}
      onRevealRelease={resolved}
      onVerifyRelease={resolved}
      onSoundcheckRelease={resolved}
      onFindAlternatives={resolved}
      onPatchReleaseFile={onPatchReleaseFile}
      relayRecords={{ "signal-relay:release-patch-bay": relayRecord }}
      online
      onLoadOfficialTracklist={async () => []}
      soundcheckEnabled
      onSetReleaseFiled={resolved}
      onClearReleaseHistory={resolved}
      onOpenTransfer={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Repair release" }));
    expect(screen.getByLabelText(/Patch Bay for Signal Choir/)).toBeInTheDocument();
    expect(screen.getByText("repair-source")).toBeInTheDocument();
    expect(screen.getByText("strong")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use track" }));
    await waitFor(() => expect(onPatchReleaseFile).toHaveBeenCalledWith(expect.objectContaining({
      releaseId: "release-patch-bay",
      targetTransferId: "broken-track",
      targetTrackNumber: null,
      result: replacement,
      allowIncompatible: false,
    })));
  });
});
