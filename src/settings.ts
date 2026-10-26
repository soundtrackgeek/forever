import { defaultBandwidth, validateBandwidth, type BandwidthSettings } from "./bandwidth";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { defaultFilingSettings, type FilingSettings } from "./filing";
import type { ConnectionProfile, UploadPolicy, WantedPreferences } from "./types";
import type { AlbumFilter } from "./components/AlbumSearchWorkspace";
import { normalizeAdvancedFilters, sortLabels, type AdvancedSearchFilters, type SearchFilter, type SearchSort } from "./utils/searchResults";

export type DialPreset = { id: string; mode: "files" | "albums"; query: string; searchFilter: SearchFilter; searchSort: SearchSort; searchLayout: "list" | "grid"; albumFilter: AlbumFilter; advancedFilters: AdvancedSearchFilters };
export type DialMemory = { pinned: DialPreset[]; recent: { mode: "files" | "albums"; query: string; closedAtMs: number }[] };
export type UpdateChannel = "stable" | "beta";
export type UpdateCheckIntervalMinutes = 0 | 1 | 5 | 15 | 30 | 60 | 360;
export type Preferences = { updateCheckIntervalMinutes: UpdateCheckIntervalMinutes; updateChannel: UpdateChannel; messageNotificationsEnabled: boolean; roomNotificationsEnabled: boolean; downloadNotificationsEnabled: boolean; musicBrainzFallbackTrackCount: number };
// Hands-off downloading for Wanted albums. The accepted format range is each
// album's own Smart Match profile; these decide how patient to be.
export type SmartDownloadSettings = { enabled: boolean; stallMinutes: number; maxAttempts: number; maxActiveAlbums: number; durationToleranceSeconds: number; allowedLengthMismatches: number };
export const defaultSmartDownloads = (): SmartDownloadSettings => ({ enabled: false, stallMinutes: 20, maxAttempts: 5, maxActiveAlbums: 2, durationToleranceSeconds: 3, allowedLengthMismatches: 0 });
export type Settings = {
  desktop: { closeToTray: boolean; startInTray: boolean };
  version: number; revision: number; webviewMigrated: boolean; connection: ConnectionProfile | null;
  transfers: { bandwidth?: BandwidthSettings; maxConcurrentDownloads: number; relaySuggestionMinutes: number; autoMirrorMinutes: number; soundcheckEnabled: boolean; filing?: FilingSettings };
  sharing: { version: number; uploadSlots: number; uploadPolicy: UploadPolicy; roots: { id: string; path: string; alias: string; enabled: boolean; addedAtMs: number }[] };
  wanted: { intervalMinutes: 0 | 15 | 30 | 60; defaultPreferences: WantedPreferences; smart: SmartDownloadSettings };
  archiveDatabasePath: string | null; preferences: Preferences; dialMemory: DialMemory;
};
export type SettingsPatch = Partial<Preferences & Settings["desktop"] & Settings["transfers"] & Pick<Settings["sharing"], "uploadSlots" | "uploadPolicy"> & { wantedIntervalMinutes: 0 | 15 | 30 | 60; wantedDefaultPreferences: WantedPreferences; wantedSmartDownloads: SmartDownloadSettings; dialMemory: DialMemory }>;
export type SettingsSection = "desktop" | "connection" | "transfers" | "sharing" | "wanted" | "archive" | "preferences" | "searches";
export const defaultSettings = (): Settings => ({
  desktop: { closeToTray: true, startInTray: true },
  version: 1, revision: 0, webviewMigrated: false, connection: null,
  transfers: { bandwidth: defaultBandwidth(), maxConcurrentDownloads: 3, relaySuggestionMinutes: 10, autoMirrorMinutes: 0, soundcheckEnabled: true, filing: defaultFilingSettings() },
  sharing: { version: 3, uploadSlots: 1, uploadPolicy: { maxFilesPerUser: 100, maxMegabytesPerUser: 10000, prioritizeFavorites: false, prioritizePrivileged: false }, roots: [] },
  wanted: { intervalMinutes: 30, defaultPreferences: { formatPreference: "preferLossless", minimumBitrateKbps: 320, minimumTrackCount: null }, smart: defaultSmartDownloads() },
  archiveDatabasePath: null,
  preferences: { updateCheckIntervalMinutes: 360, updateChannel: "stable", messageNotificationsEnabled: true, roomNotificationsEnabled: true, downloadNotificationsEnabled: true, musicBrainzFallbackTrackCount: 10 },
  dialMemory: { pinned: [], recent: [] },
});

let state = { settings: defaultSettings(), error: null as string | null, ready: false };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getSettingsState = () => state;
export const useSettings = () => useSyncExternalStore(subscribe, getSettingsState);
export function acceptSettings(settings: Settings) {
  if (settings.revision < state.settings.revision) return;
  state = { settings, error: null, ready: true }; notify();
}
export function reportSettingsError(error: unknown) {
  state = { ...state, error: error instanceof Error ? error.message : String(error) }; notify();
}
export function resetSettingsState() { state = { settings: defaultSettings(), error: null, ready: false }; notify(); }

export const legacyKeys = {
  updateCheckIntervalMinutes: "forever.updateCheckIntervalMinutes",
  messageNotificationsEnabled: "forever.messageNotificationsEnabled",
  roomNotificationsEnabled: "forever.roomNotificationsEnabled",
  musicBrainzFallbackTrackCount: "forever.musicbrainzFallbackTrackCount",
  dialMemory: "forever.dial-memory.v1",
};
export function readLegacySettings() {
  const preferences = defaultSettings().preferences;
  const cadence = localStorage.getItem(legacyKeys.updateCheckIntervalMinutes);
  if (cadence !== null && [0,1,5,15,30,60].includes(Number(cadence))) preferences.updateCheckIntervalMinutes = Number(cadence) as Preferences["updateCheckIntervalMinutes"];
  preferences.messageNotificationsEnabled = localStorage.getItem(legacyKeys.messageNotificationsEnabled) !== "false";
  preferences.roomNotificationsEnabled = localStorage.getItem(legacyKeys.roomNotificationsEnabled) !== "false";
  const count = Number(localStorage.getItem(legacyKeys.musicBrainzFallbackTrackCount));
  if (Number.isInteger(count) && count >= 1 && count <= 250) preferences.musicBrainzFallbackTrackCount = count;
  let dialMemory: DialMemory = { pinned: [], recent: [] };
  const raw = localStorage.getItem(legacyKeys.dialMemory);
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<DialMemory>;
    // Materialize defaults from older Dial Memory versions before Rust validation.
    const ids = new Set<string>();
    dialMemory = {
      pinned: (Array.isArray(parsed.pinned) ? parsed.pinned : []).filter((p) => {
        if (!p || typeof p.id !== "string" || ids.has(p.id) || typeof p.query !== "string" || !p.query.trim() || !["files", "albums"].includes(p.mode)) return false;
        ids.add(p.id); return true;
      }).slice(0, 8).map((p) => ({ id: p.id, mode: p.mode, query: p.query,
        searchFilter: ["all", "lossless", "compressed"].includes(p.searchFilter) ? p.searchFilter : "all",
        searchSort: p.searchSort in sortLabels ? p.searchSort : "best", searchLayout: p.searchLayout === "grid" ? "grid" : "list",
        albumFilter: ["all", "studio", "live", "compilation", "ep"].includes(p.albumFilter) ? p.albumFilter : "studio",
        advancedFilters: normalizeAdvancedFilters(p.advancedFilters),
      })),
      recent: (Array.isArray(parsed.recent) ? parsed.recent : []).filter((p) => p && typeof p.query === "string" && p.query.trim() && ["files", "albums"].includes(p.mode)).slice(0, 8).map((p) => ({ mode: p.mode, query: p.query, closedAtMs: Number.isSafeInteger(p.closedAtMs) && p.closedAtMs >= 0 ? p.closedAtMs : 0 })),
    };
  }
  return { preferences, dialMemory };
}

// Subscribe before reading so a simultaneous command/event cannot be missed.
export async function initializeSettings() {
  if (!isTauri()) { state = { ...state, ready: true }; notify(); return () => {}; }
  const unlisten = await listen<Settings>("forever://settings", (event) => acceptSettings(event.payload));
  try {
    const current = await invoke<Settings>("settings_get");
    acceptSettings(current);
    if (!current.webviewMigrated) acceptSettings(await invoke<Settings>("settings_migrate_webview", readLegacySettings()));
    // Cleanup is safe even if a previous launch committed but stopped before it.
    if (state.settings.webviewMigrated) Object.values(legacyKeys).forEach((key) => localStorage.removeItem(key));
  } catch (error) { reportSettingsError(error); }
  return unlisten;
}

let pendingPatch: Promise<unknown> = Promise.resolve();
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  if (!isTauri()) return action();
  const task = pendingPatch.catch(() => {}).then(action);
  pendingPatch = task;
  return task;
}
export function patchSettings(patch: SettingsPatch | ((current: Settings) => SettingsPatch)): Promise<Settings> {
  return enqueue(() => applyPatch(typeof patch === "function" ? patch(state.settings) : patch));
}
async function applyPatch(patch: SettingsPatch) {
  if (Object.keys(patch).length === 0) return state.settings;
  try {
    if (isTauri()) {
      const next = await invoke<Settings>("settings_patch", { patch }); acceptSettings(next); return next;
    }
    const next = structuredClone(state.settings);
    const { wantedIntervalMinutes, wantedDefaultPreferences, wantedSmartDownloads, dialMemory, ...fields } = patch;
    for (const [key, value] of Object.entries(fields)) {
      const target = key in next.desktop ? next.desktop : key in next.preferences ? next.preferences : key in next.transfers ? next.transfers : next.sharing;
      Object.assign(target, { [key]: value });
    }
    if (wantedIntervalMinutes !== undefined) next.wanted.intervalMinutes = wantedIntervalMinutes;
    if (wantedDefaultPreferences) next.wanted.defaultPreferences = wantedDefaultPreferences;
    if (wantedSmartDownloads) next.wanted.smart = wantedSmartDownloads;
    if (dialMemory) next.dialMemory = dialMemory;
    next.revision++; acceptSettings(next); return next;
  } catch (error) { reportSettingsError(error); throw error; }
}
export function savePreference(patch: SettingsPatch) { void patchSettings(patch).catch(() => {}); }

export async function validateSettingsImport(json: string): Promise<Settings> {
  if (json.length > 256 * 1024) throw new Error("Settings files must be smaller than 256 KiB.");
  if (isTauri()) return invoke<Settings>("settings_validate_import", { json });
  const value = JSON.parse(json) as Settings;
  if (value && value.desktop === undefined) value.desktop = defaultSettings().desktop;
  if (value?.transfers?.bandwidth && value.transfers.bandwidth.manualPaused === undefined) value.transfers.bandwidth.manualPaused = false;
  if (value?.transfers && value.transfers.bandwidth === undefined) value.transfers.bandwidth = defaultBandwidth();
  if (value?.transfers && value.transfers.autoMirrorMinutes === undefined) value.transfers.autoMirrorMinutes = 0;
  if (value?.wanted && value.wanted.smart === undefined) value.wanted.smart = defaultSmartDownloads();
  if (value?.preferences && value.preferences.downloadNotificationsEnabled === undefined) value.preferences.downloadNotificationsEnabled = true;
  // Browser previews never write desktop settings; Rust performs full validation.
  const shape = (input: unknown, example: unknown): boolean => {
    if (example === null) return input === null || typeof input === "string" || typeof input === "number";
    if (Array.isArray(example)) return Array.isArray(input);
    if (typeof example === "object") {
      if (!input || typeof input !== "object" || Array.isArray(input)) return false;
      const fields = input as Record<string, unknown>;
      return Object.entries(example).every(([key, field]) => shape(fields[key], field));
    }
    return typeof input === typeof example && (typeof input !== "number" || Number.isFinite(input));
  };
  const profile = { username: "", serverHost: "", serverPort: 0, downloadDirectory: "", rememberPassword: false, autoConnect: false, listenPort: 0, automaticPortMapping: false, allowDistributedChildren: false };
  const root = { id: "", path: "", alias: "", enabled: false, addedAtMs: 0 };
  if (!value || value.version !== 1 || !shape({ ...value, connection: null }, defaultSettings())
    || (value.connection !== null && !shape(value.connection, profile))
    || !value.sharing.roots.every((item) => shape(item, root))
    || !value.dialMemory.pinned.every((item) => shape(item, { id: "", mode: "", query: "", searchFilter: "", searchSort: "", searchLayout: "", albumFilter: "", advancedFilters: normalizeAdvancedFilters(null) }))
    || !value.dialMemory.recent.every((item) => shape(item, { mode: "", query: "", closedAtMs: 0 }))) throw new Error("Invalid settings file.");
  if (value.transfers.bandwidth) { const error = validateBandwidth(value.transfers.bandwidth); if (error) throw new Error(error); }
  return value;
}
export function importSettings(json: string) {
  return enqueue(async () => {
  const next = isTauri() ? await invoke<Settings>("settings_import", { json }) : { ...await validateSettingsImport(json), revision: state.settings.revision + 1, webviewMigrated: true };
  acceptSettings(next); window.dispatchEvent(new Event("forever-settings-restored")); return next;
  });
}
export function resetSettingsSection(section: SettingsSection) {
  return enqueue(async () => {
  if (isTauri()) { const next = await invoke<Settings>("settings_reset_section", { section }); acceptSettings(next); window.dispatchEvent(new Event("forever-settings-restored")); return; }
  const next = structuredClone(state.settings); const defaults = defaultSettings();
  if (section === "archive") next.archiveDatabasePath = null;
  else if (section === "searches") next.dialMemory = defaults.dialMemory;
  else Object.assign(next, { [section]: defaults[section] });
  next.revision++; acceptSettings(next); window.dispatchEvent(new Event("forever-settings-restored"));
  });
}
