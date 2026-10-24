import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptSettings, defaultSettings, getSettingsState, type UpdateChannel } from "../settings";
import { useAppUpdater } from "./useAppUpdater";

const { invoke, close, download, relaunch } = vi.hoisted(() => ({ invoke: vi.fn(), close: vi.fn(), download: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ Update: class {
  version: string; currentVersion: string; body = "Release notes"; rid: number;
  constructor(data: { rid: number; version: string; currentVersion: string }) { Object.assign(this, data); this.version = data.version; this.currentVersion = data.currentVersion; this.rid = data.rid; }
  close() { return close(this.rid); }
  downloadAndInstall() { return download(this.rid); }
} }));
const metadata = (rid = 1) => ({ rid, version: "0.0.74", currentVersion: "0.0.73", rawJson: {} });
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
function choose(channel: UpdateChannel) {
  act(() => acceptSettings({ ...getSettingsState().settings, revision: getSettingsState().settings.revision + 1,
    preferences: { ...getSettingsState().settings.preferences, updateChannel: channel } }));
}
beforeEach(() => {
  vi.useFakeTimers(); invoke.mockReset(); close.mockReset().mockResolvedValue(undefined);
  download.mockReset().mockResolvedValue(undefined); relaunch.mockReset().mockResolvedValue(undefined);
  invoke.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); });

it("waits for persisted settings, checks at launch and repeats every six hours", async () => {
  renderHook(useAppUpdater);
  await tick(10_000); expect(invoke).not.toHaveBeenCalled();
  act(() => acceptSettings(defaultSettings()));
  await tick(2_499); expect(invoke).not.toHaveBeenCalled();
  await tick(1); expect(invoke).toHaveBeenCalledWith("updater_check", { channel: "stable" });
  await tick(21_600_000 - 2_501); expect(invoke).toHaveBeenCalledTimes(1);
  await tick(1); expect(invoke).toHaveBeenCalledTimes(2);
});

it("startup-only still checks at launch and manually, and cleans up timers", async () => {
  const settings = defaultSettings(); settings.preferences.updateCheckIntervalMinutes = 0; acceptSettings(settings);
  const { result, unmount } = renderHook(useAppUpdater);
  await tick(2_500); await tick(43_200_000); expect(invoke).toHaveBeenCalledTimes(1);
  await act(() => result.current.checkForUpdates(true)); expect(invoke).toHaveBeenCalledTimes(2);
  unmount(); await tick(43_200_000); expect(invoke).toHaveBeenCalledTimes(2);
});

it("coalesces checks and discards a stale channel response before checking the latest choice", async () => {
  acceptSettings(defaultSettings());
  let resolve!: (data: ReturnType<typeof metadata>) => void;
  invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result } = renderHook(useAppUpdater);
  await tick(2_500);
  await act(() => result.current.checkForUpdates(true)); expect(invoke).toHaveBeenCalledTimes(1);
  choose("beta"); await tick(0); expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(metadata(7)); });
  expect(close).toHaveBeenCalledWith(7);
  expect(invoke).toHaveBeenLastCalledWith("updater_check", { channel: "beta" });
  expect(result.current.details).toBeNull(); expect(result.current.status).toBe("current");
});

it("rejects an offer from the previous channel before preparing downloads", async () => {
  acceptSettings(defaultSettings()); invoke.mockResolvedValueOnce(metadata());
  const { result } = renderHook(useAppUpdater); await tick(2_500);
  expect(result.current.status).toBe("available");
  choose("beta");
  const prepare = vi.fn();
  await act(() => result.current.installUpdate(prepare));
  expect(prepare).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  await tick(0); expect(close).toHaveBeenCalledWith(1); expect(result.current.details).toBeNull();
});

it("rechecks the channel after Safe Passage and rolls back if settings were imported", async () => {
  acceptSettings(defaultSettings()); invoke.mockResolvedValueOnce(metadata());
  const { result } = renderHook(useAppUpdater); await tick(2_500);
  let finish!: () => void;
  const prepare = () => new Promise<void>((resolve) => { finish = resolve; });
  const rollback = vi.fn().mockResolvedValue(undefined);
  let installing!: Promise<void>;
  act(() => { installing = result.current.installUpdate(prepare, rollback); });
  choose("beta"); await tick(0);
  await act(async () => { finish(); await installing; });
  expect(download).not.toHaveBeenCalled(); expect(rollback).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalledWith("connection_shutdown_network");
  expect(result.current.error).toContain("channel changed");
});

it("closes an update returned after unmount without publishing or checking again", async () => {
  acceptSettings(defaultSettings());
  let resolve!: (data: ReturnType<typeof metadata>) => void;
  invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { unmount } = renderHook(useAppUpdater); await tick(2_500); unmount();
  await act(async () => { resolve(metadata(9)); });
  expect(close).toHaveBeenCalledWith(9); expect(invoke).toHaveBeenCalledTimes(1);
});

it("releases superseded offers and recovers from a failed check", async () => {
  acceptSettings(defaultSettings()); invoke.mockResolvedValueOnce(metadata());
  const { result } = renderHook(useAppUpdater); await tick(2_500);
  invoke.mockRejectedValueOnce(new Error("Offline"));
  await act(() => result.current.checkForUpdates(true));
  expect(close).toHaveBeenCalledWith(1); expect(result.current.error).toBe("Offline");
  expect(result.current.details).toBeNull();
  await act(() => result.current.checkForUpdates(true)); expect(result.current.status).toBe("current");
});
