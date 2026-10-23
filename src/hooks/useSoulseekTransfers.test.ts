import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transfer, TransferProgressBatch, TransferQueueSnapshot } from "../types";
import { useSoulseekTransfers } from "./useSoulseekTransfers";

const { invoke, listeners, disposers } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  disposers: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    listeners.set(name, callback);
    const dispose = vi.fn(() => listeners.delete(name));
    disposers.push(dispose);
    return dispose;
  }),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(),
}));

function transfer(id: string, status: Transfer["status"] = "downloading"): Transfer {
  return {
    id, title: id, username: id, remoteFilename: `${id}.flac`, localPath: `${id}.flac`,
    sizeBytes: 1000, transferredBytes: 100, speedBytesPerSecond: 10, etaSeconds: 90,
    status, queuePosition: null, error: null, createdAtMs: 1, updatedAtMs: 1,
  };
}
function snapshot(revision = 1, transfers = [transfer("live"), transfer("history", "completed")]): TransferQueueSnapshot {
  return {
    revision, transfers, activeCount: transfers.filter((t) => t.status === "downloading").length,
    maxConcurrentDownloads: 6, relaySuggestionMinutes: 10, soundcheckEnabled: true, safetyState: "running",
  };
}
function progress(revision: number, ids = ["live"]): TransferProgressBatch {
  return { revision, updates: ids.map((id) => ({
    id, transferredBytes: 600, speedBytesPerSecond: 200, etaSeconds: 2, updatedAtMs: 2,
  })) };
}
function emit(name: string, payload: unknown) {
  act(() => listeners.get(name)!({ payload }));
}

beforeEach(() => {
  invoke.mockReset();
  listeners.clear();
  disposers.length = 0;
  invoke.mockResolvedValue(snapshot());
});

describe("native transfer progress stream", () => {
  it("merges six lanes in one update while retaining completed history and lifecycle metadata", async () => {
    const active = Array.from({ length: 6 }, (_, i) => transfer(`live-${i}`));
    const history = Array.from({ length: 10_000 }, (_, i) => transfer(`history-${i}`, "completed"));
    invoke.mockResolvedValue(snapshot(1, [...active, ...history]));
    const { result, unmount } = renderHook(useSoulseekTransfers);
    await waitFor(() => expect(result.current.ready).toBe(true));
    const previous = result.current.snapshot;
    emit("forever://transfer-progress", progress(2, active.map((t) => t.id)));
    const next = result.current.snapshot;
    expect(next.activeCount).toBe(6);
    expect(next.transfers.slice(0, 6).every((t) => t.transferredBytes === 600 && t.etaSeconds === 2)).toBe(true);
    expect(next.transfers.slice(6).every((t, i) => t === previous.transfers[i + 6])).toBe(true);
    expect(result.current.activityNotice).toBeNull();
    expect(result.current.completionNotice).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    unmount();
    expect(disposers).toHaveLength(3);
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("ignores old batches and command responses after pause, completion, and removal", async () => {
    const { result } = renderHook(useSoulseekTransfers);
    await waitFor(() => expect(result.current.ready).toBe(true));
    let finishPause!: (value: TransferQueueSnapshot) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { finishPause = resolve; }));
    let pause!: Promise<unknown>;
    act(() => { pause = result.current.pause("live"); });
    emit("forever://transfers", snapshot(4, [transfer("live", "paused")]));
    emit("forever://transfer-progress", progress(3));
    expect(result.current.snapshot.transfers[0].status).toBe("paused");
    emit("forever://transfers", snapshot(6, [transfer("live", "completed")]));
    await act(async () => { finishPause(snapshot(4, [transfer("live", "paused")])); await pause; });
    expect(result.current.snapshot.transfers[0].status).toBe("completed");
    emit("forever://transfers", snapshot(8, []));
    emit("forever://transfer-progress", progress(9));
    expect(result.current.snapshot.transfers).toEqual([]);
  });

  it("subscribes before bootstrap and replays progress newer than the initial snapshot", async () => {
    let finish!: (value: TransferQueueSnapshot) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(useSoulseekTransfers);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("transfers_snapshot"));
    expect(listeners.has("forever://transfer-progress")).toBe(true);
    emit("forever://transfer-progress", progress(2));
    await act(async () => finish(snapshot(1)));
    expect(result.current.ready).toBe(true);
    expect(result.current.snapshot.transfers[0].transferredBytes).toBe(600);
    emit("forever://transfer-progress", progress(1));
    expect(result.current.snapshot.revision).toBe(2);
  });

  it("surfaces asynchronous save errors until the writer recovers", async () => {
    const { result } = renderHook(useSoulseekTransfers);
    await waitFor(() => expect(result.current.ready).toBe(true));
    emit("forever://transfer-store-error", "disk full");
    expect(result.current.error).toBe("disk full");
    act(() => result.current.clearError());
    expect(result.current.error).toBe("disk full");
    emit("forever://transfer-store-error", null);
    expect(result.current.error).toBeNull();
  });
});
