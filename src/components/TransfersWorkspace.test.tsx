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
  it("shows a queue-wide summary and provides accessible release ordering controls", () => {
    const onReorderRelease = vi.fn();
    render(
      <TransfersWorkspace
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
    expect(screen.getByText("Queue #1")).toBeInTheDocument();
    expect(screen.getByText("Queue #2")).toBeInTheDocument();

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
});
