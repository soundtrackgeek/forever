import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Transfer, WantedAlbum, WantedSnapshot } from "../types";
import type { TransferGroup } from "../utils/transfers";
import { ArchiveWorkspace } from "./ArchiveWorkspace";

const receiptAlbum: WantedAlbum = {
  albumId: "release-group-unveiled",
  artist: "Whitecross",
  title: "Unveiled",
  firstReleaseDate: "1994-01-01",
  coverArtUrl: null,
  paused: false,
  fulfilled: true,
  fulfilledAtMs: 500,
  fulfillmentSource: "download",
  downloadReceipt: {
    releaseId: "download-unveiled",
    username: "signalsource",
    format: "MP3",
    trackCount: 1,
    sizeBytes: 10_000_000,
    soundcheck: "passed",
    completedAtMs: 500,
  },
  ownedTrackCount: null,
  preferences: {
    formatPreference: "mp3Only",
    minimumBitrateKbps: 320,
    minimumTrackCount: 1,
  },
  addedAtMs: 100,
  lastCheckedAtMs: 200,
  sourceCount: 1,
  matchingSourceCount: 1,
  readySourceCount: 1,
  completeSourceCount: 1,
  newSourceCount: 0,
  bestFormat: "MP3",
  bestTrackCount: 1,
  bestSizeBytes: 10_000_000,
  bestSpeedBytesPerSecond: 1_000_000,
  bestSource: null,
  error: null,
};

const transfer: Transfer = {
  id: "track-1",
  releaseId: "download-unveiled",
  releaseTitle: "Whitecross - Unveiled (1994)",
  releaseFolder: "C:\\Downloads\\Whitecross - Unveiled (1994)",
  releaseGroupId: "release-group-unveiled",
  fileIndex: 1,
  fileCount: 1,
  expectedTrackCount: 1,
  title: "01 - Frank.mp3",
  username: "signalsource",
  remoteFilename: "Music\\Whitecross\\Unveiled\\01 - Frank.mp3",
  sizeBytes: 10_000_000,
  transferredBytes: 10_000_000,
  speedBytesPerSecond: 0,
  etaSeconds: 0,
  status: "completed",
  queuePosition: null,
  localPath: "C:\\Downloads\\Whitecross - Unveiled (1994)\\01 - Frank.mp3",
  error: null,
  verificationStatus: "verified",
  verifiedAtMs: 500,
  soundcheck: {
    status: "passed",
    checkedAtMs: 500,
    deep: false,
    codec: "MP3",
    container: "MP3",
    durationSeconds: 240,
    bitrateKbps: 320,
    sampleRate: 44_100,
    bitsPerSample: null,
    channels: 2,
    trackNumber: 1,
    trackTotal: 1,
    issues: [],
  },
  createdAtMs: 300,
  updatedAtMs: 500,
};

const group: TransferGroup = {
  id: "download-unveiled",
  releaseId: "download-unveiled",
  title: "Whitecross - Unveiled (1994)",
  username: "signalsource",
  folder: "C:\\Downloads\\Whitecross - Unveiled (1994)",
  transfers: [transfer],
  sizeBytes: 10_000_000,
  transferredBytes: 10_000_000,
  speedBytesPerSecond: 0,
  etaSeconds: 0,
  status: "completed",
  queueIndex: 0,
  queuePosition: null,
  createdAtMs: 300,
  updatedAtMs: 500,
};

const wanted: WantedSnapshot = {
  albums: [receiptAlbum],
  defaultPreferences: receiptAlbum.preferences,
  intervalMinutes: 30,
  activeAlbumId: null,
  nextCheckAtMs: null,
  updatedAtMs: 500,
};

describe("Fulfilled Shelf", () => {
  it("keeps a verified download visible and lets the listener restore its watch", () => {
    const restore = vi.fn(async () => undefined);
    render(
      <ArchiveWorkspace
        initialTab="wanted"
        status={null}
        loading={false}
        error={null}
        wanted={wanted}
        wantedReady
        wantedError={null}
        online
        onRefresh={vi.fn(async () => ({ path: "", connected: false, readOnly: true, albumCount: null, trackCount: null, lastImportedAt: null, lastModifiedAtMs: null, error: null }))}
        onSetWantedInterval={vi.fn(async () => undefined)}
        onCheckWanted={vi.fn(async () => undefined)}
        onSetWantedPaused={vi.fn(async () => undefined)}
        onRemoveWanted={vi.fn(async () => undefined)}
        onRestoreWanted={restore}
        onOpenWanted={vi.fn()}
        onReviewBest={vi.fn()}
        onEditPreferences={vi.fn()}
        downloadStateByAlbumId={new Map()}
        onOpenTransfer={vi.fn()}
        onDismissWantedError={vi.fn()}
        transferGroups={[group]}
        archiveOwnedReleaseIds={new Set()}
        onRevealRelease={vi.fn(async () => undefined)}
        onVerifyRelease={vi.fn(async () => undefined)}
        onSoundcheckRelease={vi.fn(async () => undefined)}
        onFindAlternatives={vi.fn(async () => undefined)}
        onPatchReleaseFile={vi.fn(async () => undefined)}
        relayRecords={{}}
        onLoadOfficialTracklist={vi.fn(async () => [])}
        soundcheckEnabled
        onSetReleaseFiled={vi.fn(async () => undefined)}
        onClearReleaseHistory={vi.fn(async () => undefined)}
        missingShelf={<div>Missing shelf</div>}
        onOpenMissing={vi.fn()}
      />,
    );

    expect(screen.getByText("Verified download")).toBeInTheDocument();
    expect(screen.getByText("1 audio track · Soundcheck passed")).toBeInTheDocument();
    expect(screen.getByText("10.0 MB · from signalsource")).toBeInTheDocument();
    expect(screen.getByText("Ready to file")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add back/i }));
    expect(restore).toHaveBeenCalledWith("release-group-unveiled");
  });
});
