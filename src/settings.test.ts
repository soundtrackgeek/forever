import { beforeEach, expect, it, vi } from "vitest";
import { acceptSettings, defaultSettings, getSettingsState, initializeSettings, legacyKeys, patchSettings, readLegacySettings, resetSettingsState, type Settings } from "./settings";

const { invoke, listen, dispose } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), dispose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
beforeEach(() => { resetSettingsState(); invoke.mockReset(); listen.mockReset(); dispose.mockReset(); listen.mockResolvedValue(dispose); });

it("migrates WebView preferences and pinned presets only after a successful save", async () => {
  localStorage.setItem(legacyKeys.updateCheckIntervalMinutes, "0");
  localStorage.setItem(legacyKeys.messageNotificationsEnabled, "false");
  localStorage.setItem(legacyKeys.musicBrainzFallbackTrackCount, "24");
  localStorage.setItem(legacyKeys.dialMemory, JSON.stringify({ pinned: [{ id: "old", mode: "files", query: "album", searchSort: "ready" }], recent: [] }));
  localStorage.setItem("drafts", "keep my draft");
  invoke.mockImplementation(async (command, args) => {
    if (command === "settings_get") return defaultSettings();
    expect(command).toBe("settings_migrate_webview");
    expect(localStorage.getItem(legacyKeys.messageNotificationsEnabled)).toBe("false");
    return { ...defaultSettings(), revision: 1, webviewMigrated: true, ...args };
  });
  const stop = await initializeSettings();
  expect(getSettingsState().settings.preferences).toMatchObject({ updateCheckIntervalMinutes: 0, messageNotificationsEnabled: false, musicBrainzFallbackTrackCount: 24 });
  expect(getSettingsState().settings.dialMemory.pinned[0]).toMatchObject({ searchSort: "ready", searchLayout: "list", advancedFilters: { minimumBitrate: null } });
  for (const key of Object.values(legacyKeys)) expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem("drafts")).toBe("keep my draft"); stop(); expect(dispose).toHaveBeenCalledOnce();
});

it("keeps legacy values and reports the error when migration fails", async () => {
  localStorage.setItem(legacyKeys.roomNotificationsEnabled, "false");
  invoke.mockImplementation(async (command) => { if (command === "settings_get") return defaultSettings(); throw new Error("Disk full"); });
  const stop = await initializeSettings();
  expect(localStorage.getItem(legacyKeys.roomNotificationsEnabled)).toBe("false");
  expect(getSettingsState().error).toBe("Disk full"); stop();
});

it("does not replay legacy settings over an imported or previously migrated store", async () => {
  localStorage.setItem(legacyKeys.messageNotificationsEnabled, "false");
  invoke.mockResolvedValue({ ...defaultSettings(), webviewMigrated: true, revision: 7 });
  const stop = await initializeSettings();
  expect(invoke).toHaveBeenCalledTimes(1); expect(getSettingsState().settings.preferences.messageNotificationsEnabled).toBe(true);
  expect(localStorage.getItem(legacyKeys.messageNotificationsEnabled)).toBeNull(); stop();
});

it("serializes rapid saves and rejects late event and command snapshots", async () => {
  let firstDone!: (settings: Settings) => void;
  invoke.mockImplementationOnce(() => new Promise((resolve) => { firstDone = resolve; }));
  invoke.mockResolvedValueOnce({ ...defaultSettings(), revision: 2, preferences: { ...defaultSettings().preferences, messageNotificationsEnabled: true } });
  const first = patchSettings({ messageNotificationsEnabled: false });
  const second = patchSettings({ messageNotificationsEnabled: true });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  firstDone({ ...defaultSettings(), revision: 1, preferences: { ...defaultSettings().preferences, messageNotificationsEnabled: false } });
  await Promise.all([first, second]);
  expect(invoke).toHaveBeenNthCalledWith(2, "settings_patch", { patch: { messageNotificationsEnabled: true } });
  acceptSettings({ ...defaultSettings(), revision: 1, preferences: { ...defaultSettings().preferences, messageNotificationsEnabled: false } });
  expect(getSettingsState().settings.revision).toBe(2); expect(getSettingsState().settings.preferences.messageNotificationsEnabled).toBe(true);
});

it("a rejected patch leaves the previous displayed value intact and reports the failure", async () => {
  acceptSettings({ ...defaultSettings(), revision: 3 }); invoke.mockRejectedValueOnce(new Error("Read-only settings"));
  await expect(patchSettings({ musicBrainzFallbackTrackCount: 250 })).rejects.toThrow("Read-only settings");
  expect(getSettingsState().settings.preferences.musicBrainzFallbackTrackCount).toBe(10); expect(getSettingsState().error).toBe("Read-only settings");
});

it("normalizes old preference values while leaving malformed preset JSON available for recovery", () => {
  localStorage.setItem(legacyKeys.musicBrainzFallbackTrackCount, "900"); localStorage.setItem(legacyKeys.updateCheckIntervalMinutes, "2");
  expect(readLegacySettings().preferences).toMatchObject({ musicBrainzFallbackTrackCount: 10, updateCheckIntervalMinutes: 360, updateChannel: "stable" });
  localStorage.setItem(legacyKeys.dialMemory, "broken JSON"); expect(() => readLegacySettings()).toThrow();
  expect(localStorage.getItem(legacyKeys.dialMemory)).toBe("broken JSON");
});

it("preserves legacy cadence choices and keeps the channel unchanged after a failed save", async () => {
  for (const interval of [0, 1, 5, 15, 30, 60]) {
    localStorage.setItem(legacyKeys.updateCheckIntervalMinutes, String(interval));
    expect(readLegacySettings().preferences.updateCheckIntervalMinutes).toBe(interval);
  }
  invoke.mockRejectedValueOnce(new Error("Disk full"));
  await expect(patchSettings({ updateChannel: "beta" })).rejects.toThrow("Disk full");
  expect(getSettingsState().settings.preferences.updateChannel).toBe("stable");
});

it("does not enable automatic mirrors when saving the opt-in fails", async () => {
  expect(defaultSettings().transfers.autoMirrorMinutes).toBe(0);
  invoke.mockRejectedValueOnce(new Error("Disk full"));
  await expect(patchSettings({ autoMirrorMinutes: 5 })).rejects.toThrow("Disk full");
  expect(getSettingsState().settings.transfers.autoMirrorMinutes).toBe(0);
});
