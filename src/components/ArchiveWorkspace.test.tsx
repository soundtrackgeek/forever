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
  etaIncludesQueue: false,
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
  wishlistIntervalSeconds: 720,
  effectiveCadenceMinutes: 30,
  checkQueued: false,
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
        wantedMatches={new Map()}
        onSelectDatabase={vi.fn()}
        wantedError={null}
        online
        onRefresh={vi.fn(async () => ({ path: "", pathSource: "automatic" as const, settingsNotice: null, connected: false, readOnly: true, albumCount: null, trackCount: null, lastImportedAt: null, lastModifiedAtMs: null, error: null }))}
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

describe("Smart downloads on the Wanted list", () => {
  const watching: WantedAlbum = {
    ...receiptAlbum,
    fulfilled: false,
    fulfilledAtMs: null,
    fulfillmentSource: null,
    downloadReceipt: null,
    bestSource: null,
    autoDownload: true,
    smart: { attempts: 2, tried: [], resumeAtMs: null, lastRecheckAtMs: null, message: null, updatedAtMs: 1,
      current: { releaseId: "download-unveiled", username: "signalsource", folder: "Music\\Whitecross\\Unveiled", startedAtMs: 300 } },
  };
  const smartSettings = { enabled: true, stallMinutes: 20, maxAttempts: 5, maxActiveAlbums: 2, durationToleranceSeconds: 3, allowedLengthMismatches: 0 };

  const renderWanted = (album: WantedAlbum, extra: Partial<React.ComponentProps<typeof ArchiveWorkspace>> = {}) => {
    const setAuto = vi.fn(async () => undefined);
    render(
      <ArchiveWorkspace
        initialTab="wanted" status={null} loading={false} error={null}
        wanted={{ ...wanted, albums: [album] }} wantedReady wantedMatches={new Map()}
        onSelectDatabase={vi.fn()} wantedError={null} online
        onRefresh={vi.fn()} onSetWantedInterval={vi.fn(async () => undefined)} onCheckWanted={vi.fn(async () => undefined)}
        onSetWantedPaused={vi.fn(async () => undefined)} onRemoveWanted={vi.fn(async () => undefined)} onRestoreWanted={vi.fn(async () => undefined)}
        onOpenWanted={vi.fn()} onReviewBest={vi.fn()} onEditPreferences={vi.fn()}
        smartDownloads={smartSettings} onSetAutoDownload={setAuto}
        downloadStateByAlbumId={new Map()} onOpenTransfer={vi.fn()} onDismissWantedError={vi.fn()}
        transferGroups={[{ ...group, status: "active" }]} archiveOwnedReleaseIds={new Set()}
        onRevealRelease={vi.fn(async () => undefined)} onVerifyRelease={vi.fn(async () => undefined)} onSoundcheckRelease={vi.fn(async () => undefined)}
        onFindAlternatives={vi.fn(async () => undefined)} onPatchReleaseFile={vi.fn(async () => undefined)} relayRecords={{}}
        onLoadOfficialTracklist={vi.fn(async () => [])} soundcheckEnabled
        onSetReleaseFiled={vi.fn(async () => undefined)} onClearReleaseHistory={vi.fn(async () => undefined)}
        missingShelf={<div>Missing shelf</div>} onOpenMissing={vi.fn()}
        {...extra}
      />,
    );
    return setAuto;
  };

  it("says which source is downloading and how many have been tried", () => {
    renderWanted(watching);
    expect(screen.getByText("Auto · downloading from signalsource · source 2 of 5")).toBeInTheDocument();
  });

  it("lets one album opt out of automatic downloading, and back in", () => {
    const setAuto = renderWanted(watching);
    const toggle = screen.getByRole("button", { name: "Automatic download for Unveiled" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(setAuto).toHaveBeenCalledWith("release-group-unveiled", false);
  });

  it("shows an opted-out album as off and offers to turn it on", () => {
    const setAuto = renderWanted({ ...watching, autoDownload: false });
    expect(screen.getByText("Auto-download off for this album")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Automatic download for Unveiled" }));
    expect(setAuto).toHaveBeenCalledWith("release-group-unveiled", true);
  });

  it("shows nothing about Auto while Smart downloads is switched off", () => {
    renderWanted(watching, { smartDownloads: { ...smartSettings, enabled: false } });
    expect(screen.queryByRole("button", { name: /Automatic download for/ })).toBeNull();
    expect(screen.queryByText(/^Auto/)).toBeNull();
  });
});
