import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FolderInspection } from "../types";
import { groupTransfers } from "../utils/transfers";
import { useAutomaticRelay } from "./useAutomaticRelay";
import type { SearchSessionRecord } from "./useSoulseekSearch";

const waiting = { id: "one", releaseId: "album", title: "One", username: "original", remoteFilename: "album/01.flac",
  localPath: "01.flac", sizeBytes: 1000, transferredBytes: 200, speedBytesPerSecond: 0, etaSeconds: null,
  status: "remotelyQueued" as const, waitingSinceMs: 1, queuePosition: 3, error: null, createdAtMs: 1, updatedAtMs: 1 };
const mirror = { username: "mirror", remoteFolder: "other", files: [{ title: "01.flac", remoteFilename: "other/01.flac", sizeBytes: 1000 }] };
const record: SearchSessionRecord = {
  error: null, unseenCount: 0,
  snapshot: { clientId: "signal-relay:album", state: "completed", token: 1, query: "Album", resultCount: 1, peerCount: 1, message: "", startedAtMs: 1, finishedAtMs: 2 },
  results: [{ id: "candidate", title: "01.flac", filename: "other/01.flac", folder: "other", owner: "mirror", sizeBytes: 1000,
    subtitle: "", trust: 0, format: "FLAC", quality: "", size: "", tracks: 1, rating: 0, ratingLabel: "", availability: [] }],
};
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(600_001);
  return { enabled: true, minutes: 5, groups: groupTransfers([{ ...waiting, alternativeSources: [mirror] }]), memory: {}, records: {} as Record<string, SearchSessionRecord>,
    excluded: vi.fn(() => false), startSearch: vi.fn(async () => {}), inspect: vi.fn<() => Promise<FolderInspection>>(),
    switchSource: vi.fn(async () => true), closeSearch: vi.fn(async () => {}) };
}
afterEach(() => vi.useRealTimers());

describe("automatic relay controller", () => {
  it("switches a known exact mirror and closes its background search", async () => {
    const inputs = setup();
    const hook = renderHook(() => useAutomaticRelay(inputs));
    await act(async () => {});
    expect(inputs.switchSource).toHaveBeenCalledWith("album", mirror);
    expect(inputs.closeSearch).toHaveBeenCalledWith("signal-relay:album");
    expect(inputs.startSearch).not.toHaveBeenCalled(); hook.unmount();
  });
  it("does nothing while off, offline, paused or blocked", async () => {
    for (const mode of ["off", "offline", "paused", "blocked"]) {
      const inputs = setup();
      if (mode === "off") inputs.minutes = 0;
      if (mode === "offline") inputs.enabled = false;
      if (mode === "paused") inputs.groups = groupTransfers([{ ...waiting, status: "paused", alternativeSources: [mirror] }]);
      if (mode === "blocked") inputs.excluded.mockReturnValue(true);
      const hook = renderHook(() => useAutomaticRelay(inputs)); await act(async () => {});
      expect(inputs.switchSource).not.toHaveBeenCalled(); hook.unmount();
    }
  });
  it("bounds empty scans to five minutes and avoids overlapping work", async () => {
    const inputs = setup(); inputs.groups = groupTransfers([waiting]);
    const hook = renderHook(() => useAutomaticRelay(inputs)); await act(async () => {});
    expect(inputs.startSearch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(270_000)); expect(inputs.startSearch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000)); expect(inputs.startSearch).toHaveBeenCalledTimes(2); hook.unmount();
  });
  it("rechecks opt-in after a delayed folder inspection", async () => {
    const inputs = setup(); inputs.groups = groupTransfers([waiting]); inputs.records = { "signal-relay:album": record };
    let finish!: (folder: FolderInspection) => void;
    inputs.inspect.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const hook = renderHook((props) => useAutomaticRelay(props), { initialProps: inputs }); await act(async () => {});
    expect(inputs.inspect).toHaveBeenCalledTimes(1);
    hook.rerender({ ...inputs, minutes: 0 });
    await act(async () => finish({ username: "mirror", token: 1, requestedFolder: "other", receivedAtMs: 2,
      files: [{ filename: "01.flac", remoteFilename: "other/01.flac", sizeBytes: 1000, directory: "other", extension: "flac", bitrate: null, durationSeconds: null, vbr: null, sampleRate: null, bitDepth: null }] }));
    expect(inputs.switchSource).not.toHaveBeenCalled(); hook.unmount();
  });
  it("rejects a folder whose full inspection differs from its search hint", async () => {
    const inputs = setup(); inputs.groups = groupTransfers([waiting]); inputs.records = { "signal-relay:album": record };
    inputs.inspect.mockResolvedValue({ username: "mirror", token: 1, requestedFolder: "other", receivedAtMs: 2, files: [] });
    const hook = renderHook(() => useAutomaticRelay(inputs)); await act(async () => {});
    expect(inputs.inspect).toHaveBeenCalledTimes(1); expect(inputs.switchSource).not.toHaveBeenCalled(); hook.unmount();
  });
});
