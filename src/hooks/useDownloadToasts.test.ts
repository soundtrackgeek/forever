import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupsOf, releaseTransfers } from "../test/smartFixture";
import type { TransferGroup } from "../utils/transfers";
import { useDownloadToasts } from "./useDownloadToasts";

const mocks = vi.hoisted(() => ({
  background: vi.fn(),
  granted: vi.fn(),
  request: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../utils/appFocus", () => ({ appIsInBackground: mocks.background }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.granted,
  requestPermission: mocks.request,
  sendNotification: mocks.send,
}));

const downloading = (releaseId = "release-1"): TransferGroup[] =>
  groupsOf(releaseTransfers({ releaseId, status: "downloading", transferredBytes: 5 }));
const verified = (releaseId = "release-1"): TransferGroup[] =>
  groupsOf(releaseTransfers({ releaseId, status: "completed" }));

type Props = { groups: TransferGroup[]; ready?: boolean; enabled?: boolean };
const mount = (initial: Props) =>
  renderHook((props: Props) => useDownloadToasts({ ready: true, enabled: true, ...props }), { initialProps: initial });

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.background.mockResolvedValue(true);
  mocks.granted.mockResolvedValue(true);
});

describe("download completion toasts", () => {
  it("announces an album that finishes and verifies while Forever is in the background", async () => {
    const view = mount({ groups: downloading() });
    view.rerender({ groups: verified() });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith({
      title: "Whitecross - Unveiled (1994) is ready",
      body: "Downloaded and verified · 2 tracks · FLAC · from alice",
    });
  });

  it("stays quiet while the person is looking at Forever", async () => {
    mocks.background.mockResolvedValue(false);
    const view = mount({ groups: downloading() });
    view.rerender({ groups: verified() });
    await waitFor(() => expect(mocks.background).toHaveBeenCalled());
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("waits for verification instead of announcing the last byte", async () => {
    const view = mount({ groups: downloading() });
    view.rerender({ groups: groupsOf(releaseTransfers({ status: "completed", verification: "pending", soundcheck: null })) });
    await Promise.resolve();
    expect(mocks.background).not.toHaveBeenCalled();
    view.rerender({ groups: verified() });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  });

  it("does not repeat itself for the same release", async () => {
    const view = mount({ groups: downloading() });
    view.rerender({ groups: verified() });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    view.rerender({ groups: verified() });
    view.rerender({ groups: [...verified()] });
    await Promise.resolve();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("treats albums already finished at launch as history", async () => {
    const view = mount({ groups: verified() });
    view.rerender({ groups: [...verified()] });
    await Promise.resolve();
    expect(mocks.background).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does nothing before transfers have loaded", async () => {
    const view = mount({ groups: downloading(), ready: false });
    view.rerender({ groups: verified(), ready: false });
    await Promise.resolve();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("respects the notification preference", async () => {
    const view = mount({ groups: downloading(), enabled: false });
    view.rerender({ groups: verified(), enabled: false });
    await Promise.resolve();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("asks for permission once and gives up quietly when it is refused", async () => {
    mocks.granted.mockResolvedValue(false);
    mocks.request.mockResolvedValue("denied");
    const view = mount({ groups: downloading() });
    view.rerender({ groups: verified() });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("summarizes a burst of finished albums in one toast", async () => {
    const ids = ["r1", "r2", "r3", "r4"];
    const view = mount({ groups: groupsOf(...ids.map((releaseId) => releaseTransfers({ releaseId, status: "downloading" }))) });
    view.rerender({ groups: groupsOf(...ids.map((releaseId) => releaseTransfers({ releaseId, status: "completed" }))) });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send.mock.calls[0][0].title).toBe("4 albums downloaded and verified");
  });
});
