import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Transfer } from "../types";
import { TransfersWorkspace } from "./TransfersWorkspace";

const releaseTransfer = (
  releaseId: string,
  title: string,
  status: Transfer["status"],
  overrides: Partial<Transfer> = {},
): Transfer => ({
  id: `${releaseId}-track`,
  releaseId,
  releaseTitle: title,
  releaseFolder: `C:\\Downloads\\${title}`,
  fileIndex: 1,
  fileCount: 1,
  title: `${title}.flac`,
  username: `source-${releaseId}`,
  remoteFilename: `Music\\${title}\\${title}.flac`,
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

describe("TransfersWorkspace signal order", () => {
  it("shows when Safe Passage has stopped the local queue for an update", () => {
    render(
      <TransfersWorkspace
        safetyState="draining"
        maxConcurrentDownloads={3}
        relaySuggestionMinutes={10}
        relayRecords={{}}
        online
        archiveOwnedReleaseIds={new Set()}
        transfers={[releaseTransfer("release-a", "Release A", "downloading")]}
        uploads={[]}
        uploadError={null}
        error={null}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        onPauseRelease={vi.fn()}
        onResumeRelease={vi.fn()}
        onCancelRelease={vi.fn()}
        onRevealRelease={vi.fn()}
        onReorderRelease={vi.fn()}
        onClearCompleted={vi.fn()}
        onVerifyRelease={vi.fn()}
        onRetryReleaseIssues={vi.fn()}
        onSwitchReleaseSource={vi.fn()}
        onFindAlternatives={vi.fn()}
        onRelayReleaseSource={vi.fn().mockResolvedValue(undefined)}
        onDismissError={vi.fn()}
        personByUsername={() => null}
        onOpenPerson={vi.fn()}
        onCancelUpload={vi.fn()}
        onClearFinishedUploads={vi.fn()}
        onDismissUploadError={vi.fn()}
      />,
    );

    expect(screen.getByText("Safe Passage · Update scheduled")).toBeInTheDocument();
    expect(
      screen.getByText("Current files may finish; the queue will not advance."),
    ).toBeInTheDocument();
  });

  it("shows a queue-wide summary and provides accessible release ordering controls", () => {
    const onReorderRelease = vi.fn();
    render(
      <TransfersWorkspace
        safetyState="running"
        maxConcurrentDownloads={3}
        relaySuggestionMinutes={10}
        relayRecords={{}}
        online
        archiveOwnedReleaseIds={new Set()}
        transfers={[
          releaseTransfer("release-a", "Release A", "downloading", {
            sizeBytes: 5_000,
            transferredBytes: 1_000,
            speedBytesPerSecond: 1_000,
          }),
          releaseTransfer("release-b", "Release B", "queued", {
            sizeBytes: 6_000,
          }),
          releaseTransfer("release-c", "Release C", "queued", {
            sizeBytes: 7_000,
          }),
        ]}
        uploads={[]}
        uploadError={null}
        error={null}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        onPauseRelease={vi.fn()}
        onResumeRelease={vi.fn()}
        onCancelRelease={vi.fn()}
        onRevealRelease={vi.fn()}
        onReorderRelease={onReorderRelease}
        onClearCompleted={vi.fn()}
        onVerifyRelease={vi.fn()}
        onRetryReleaseIssues={vi.fn()}
        onSwitchReleaseSource={vi.fn()}
        onFindAlternatives={vi.fn()}
        onRelayReleaseSource={vi.fn().mockResolvedValue(undefined)}
        onDismissError={vi.fn()}
        personByUsername={() => null}
        onOpenPerson={vi.fn()}
        onCancelUpload={vi.fn()}
        onClearFinishedUploads={vi.fn()}
        onDismissUploadError={vi.fn()}
      />,
    );

    const summary = screen.getByLabelText("Download queue summary");
    expect(within(summary).getByText("3 releases · 3 files")).toBeInTheDocument();
    expect(within(summary).getByText("17.0 KB")).toBeInTheDocument();
    expect(within(summary).getByText("17s")).toBeInTheDocument();
    expect(screen.getByText("Local queue #1")).toBeInTheDocument();
    expect(screen.getByText("Local queue #2")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Download Release C next" }),
    );
    expect(onReorderRelease).toHaveBeenLastCalledWith(
      "release-c",
      "release-b-track",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Move Release B down" }),
    );
    expect(onReorderRelease).toHaveBeenLastCalledWith("release-b", null);

    const releaseBCard = screen.getByText("Release B").closest("article");
    expect(releaseBCard).not.toBeNull();
    vi.spyOn(releaseBCard!, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const dragHandle = screen.getByRole("button", {
      name: "Drag Release C to reorder",
    });
    fireEvent.mouseDown(dragHandle, { button: 0 });
    expect(releaseBCard!.parentElement?.querySelector(".is-reordering")).not.toBeNull();

    const mouseMove = createEvent.mouseMove(releaseBCard!);
    Object.defineProperty(mouseMove, "clientY", { value: 10 });
    fireEvent(releaseBCard!, mouseMove);
    expect(releaseBCard).toHaveClass("is-drop-before");

    const mouseUp = createEvent.mouseUp(releaseBCard!);
    Object.defineProperty(mouseUp, "clientY", { value: 10 });
    fireEvent(releaseBCard!, mouseUp);
    expect(onReorderRelease).toHaveBeenLastCalledWith(
      "release-c",
      "release-b-track",
    );

    fireEvent.keyDown(dragHandle, { key: "ArrowUp" });
    expect(onReorderRelease).toHaveBeenLastCalledWith(
      "release-c",
      "release-b-track",
    );
  });

  it("opens Signal Relay with ranked fresh sources for a stalled release", async () => {
    const onFindAlternatives = vi.fn();
    const onRelayReleaseSource = vi.fn().mockResolvedValue(undefined);
    const stalled = releaseTransfer("relay-release", "Artist - Waiting Album (1994)", "remotelyQueued", {
      queuePosition: 131,
      waitingSinceMs: Date.now() - 12 * 60_000 - 1_000,
      alternativeSources: [],
    });
    render(
      <TransfersWorkspace
        safetyState="running"
        maxConcurrentDownloads={3}
        relaySuggestionMinutes={10}
        relayRecords={{
          "signal-relay:relay-release": {
            snapshot: {
              state: "completed",
              token: 91,
              clientId: "signal-relay:relay-release",
              query: "Artist Waiting Album",
              resultCount: 1,
              peerCount: 1,
              message: "Found one source.",
              startedAtMs: Date.now() - 1_000,
              finishedAtMs: Date.now(),
            },
            results: [{
              id: "relay-result",
              title: "01 - Waiting Album.flac",
              subtitle: "Music / Artist / Waiting Album",
              owner: "faster-listener",
              trust: 100,
              format: "FLAC",
              quality: "16 / 44.1",
              size: "42 MB",
              tracks: 1,
              rating: 5,
              ratingLabel: "Ready",
              availability: [],
              source: "live",
              filename: "Music\\Artist\\Waiting Album\\01 - Waiting Album.flac",
              folder: "Music\\Artist\\Waiting Album",
              sizeBytes: 42_000_000,
              slotFree: true,
              averageSpeed: 8_000_000,
              queueLength: 0,
            }],
            error: null,
            unseenCount: 0,
          },
        }}
        online
        archiveOwnedReleaseIds={new Set()}
        transfers={[stalled]}
        uploads={[]}
        uploadError={null}
        error={null}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        onPauseRelease={vi.fn()}
        onResumeRelease={vi.fn()}
        onCancelRelease={vi.fn()}
        onRevealRelease={vi.fn()}
        onReorderRelease={vi.fn()}
        onClearCompleted={vi.fn()}
        onVerifyRelease={vi.fn()}
        onRetryReleaseIssues={vi.fn()}
        onSwitchReleaseSource={vi.fn()}
        onFindAlternatives={onFindAlternatives}
        onRelayReleaseSource={onRelayReleaseSource}
        onDismissError={vi.fn()}
        personByUsername={() => null}
        onOpenPerson={vi.fn()}
        onCancelUpload={vi.fn()}
        onClearFinishedUploads={vi.fn()}
        onDismissUploadError={vi.fn()}
      />,
    );

    expect(screen.getByText(/Source queue #131 · waiting 12m/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 route ready/i }));
    expect(screen.getByText("Choose the signal worth following.")).toBeInTheDocument();
    expect(screen.getByText("faster-listener")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch source" }));
    expect(onRelayReleaseSource).toHaveBeenCalledWith(
      "relay-release",
      expect.objectContaining({ owner: "faster-listener" }),
    );
    expect(onFindAlternatives).not.toHaveBeenCalled();
  });

  it("shows Archive-owned missing audio as freshly checked and filed away", () => {
    const checkedAt = Date.now() - 121_000;
    const audio = releaseTransfer(
      "archive-release",
      "Whitecross - In the Kingdom (1991)",
      "completed",
      {
        id: "archive-audio",
        fileIndex: 1,
        fileCount: 2,
        title: "04 - In His Hands.mp3",
        remoteFilename: "Music\\Whitecross\\In the Kingdom\\04 - In His Hands.mp3",
        transferredBytes: 1_000,
        verificationStatus: "missing",
        verifiedAtMs: checkedAt,
      },
    );
    const lyric = releaseTransfer(
      "archive-release",
      "Whitecross - In the Kingdom (1991)",
      "completed",
      {
        id: "archive-lyric",
        fileIndex: 2,
        fileCount: 2,
        title: "04 - In His Hands.lrc",
        remoteFilename: "Music\\Whitecross\\In the Kingdom\\04 - In His Hands.lrc",
        transferredBytes: 1_000,
        verificationStatus: "verified",
        verifiedAtMs: checkedAt,
      },
    );

    render(
      <TransfersWorkspace
        safetyState="running"
        maxConcurrentDownloads={3}
        relaySuggestionMinutes={10}
        relayRecords={{}}
        online
        archiveOwnedReleaseIds={new Set(["archive-release"])}
        transfers={[audio, lyric]}
        uploads={[]}
        uploadError={null}
        error={null}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        onPauseRelease={vi.fn()}
        onResumeRelease={vi.fn()}
        onCancelRelease={vi.fn()}
        onRevealRelease={vi.fn()}
        onReorderRelease={vi.fn()}
        onClearCompleted={vi.fn()}
        onVerifyRelease={vi.fn()}
        onRetryReleaseIssues={vi.fn()}
        onSwitchReleaseSource={vi.fn()}
        onFindAlternatives={vi.fn()}
        onRelayReleaseSource={vi.fn().mockResolvedValue(undefined)}
        onDismissError={vi.fn()}
        personByUsername={() => null}
        onOpenPerson={vi.fn()}
        onCancelUpload={vi.fn()}
        onClearFinishedUploads={vi.fn()}
        onDismissUploadError={vi.fn()}
      />,
    );

    const release = screen
      .getByText("Whitecross - In the Kingdom (1991)")
      .closest("article") as HTMLElement;
    expect(within(release).getByText("Filed away")).toBeInTheDocument();
    expect(within(release).getAllByText("Filed away in Music Library")).toHaveLength(2);
    expect(within(release).getByText(/Archive owns album · Checked 2m ago/)).toBeInTheDocument();
    expect(within(release).queryByText("Needs attention")).not.toBeInTheDocument();
  });
});
