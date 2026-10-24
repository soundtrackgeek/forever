import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReleaseRadar, type ReleaseRadarSnapshot } from "./useReleaseRadar";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
const snapshot = (revision: number): ReleaseRadarSnapshot => ({ artists: [], releases: [], revision, checking: null, error: null, notices: [] });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
describe("release radar synchronization", () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.listen.mockReset(); mocks.stop.mockReset(); mocks.listen.mockResolvedValue(mocks.stop); });
  it("subscribes before loading and ignores older command responses after events", async () => {
    const boot = deferred<ReleaseRadarSnapshot>();
    mocks.invoke.mockReturnValueOnce(boot.promise);
    const { result, unmount } = renderHook(useReleaseRadar);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("release_radar_snapshot"));
    const event = mocks.listen.mock.calls[0][1] as (e: { payload: ReleaseRadarSnapshot }) => void;
    act(() => event({ payload: snapshot(3) }));
    await act(async () => { boot.resolve(snapshot(1)); await boot.promise; });
    expect(result.current.snapshot.revision).toBe(3);
    mocks.invoke.mockResolvedValueOnce(snapshot(2));
    await act(() => result.current.follow("id", "Artist"));
    expect(result.current.snapshot.revision).toBe(3);
    expect(mocks.invoke).toHaveBeenLastCalledWith("release_radar_follow", { artistId: "id", name: "Artist", autoAdd: false });
    unmount(); expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it("keeps durable data on mutation failure and surfaces the failure", async () => {
    mocks.invoke.mockResolvedValueOnce(snapshot(1)).mockRejectedValueOnce("Disk full");
    const { result } = renderHook(useReleaseRadar);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await expect(result.current.follow("id", "Artist")).rejects.toBe("Disk full"); });
    expect(result.current.snapshot.revision).toBe(1);
    expect(result.current.error).toBe("Disk full");
    expect(result.current.pending).toBe(false);
  });
  it("unsubscribes if initialization completes after unmount", async () => {
    const subscription = deferred<() => void>(); mocks.listen.mockReturnValueOnce(subscription.promise);
    const { unmount } = renderHook(useReleaseRadar); unmount();
    await act(async () => { subscription.resolve(mocks.stop); await subscription.promise; });
    expect(mocks.stop).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
