import { acceptSettings, defaultSettings, getSettingsState, readLegacySettings } from "../settings";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDialMemory } from "./useDialMemory";
import { defaultAdvancedFilters } from "../utils/searchResults";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async (_command, { patch }) => ({ ...getSettingsState().settings, revision: getSettingsState().settings.revision + 1, dialMemory: patch.dialMemory })) }));

it("migrates pinned presets and retains advanced filters through switching, duplication and restart", async () => {
  localStorage.setItem("forever.dial-memory.v1", JSON.stringify({ pinned: [{ id: "old", mode: "files", query: "album", searchSort: "ready" }], recent: [] }));
  acceptSettings({ ...defaultSettings(), ...readLegacySettings(), webviewMigrated: true });
  const first = renderHook(() => useDialMemory());
  expect(first.result.current.active.advancedFilters).toEqual(defaultAdvancedFilters);
  const settings = { ...defaultAdvancedFilters, minimumBitrate: 320, countries: "NO", resultsPerUser: 3, hideBlockedIgnored: true };
  act(() => first.result.current.update("old", { advancedFilters: settings, searchSort: "qualityDesc" }));
  let duplicate: string | null = null;
  act(() => { duplicate = first.result.current.duplicate("old"); });
  expect(first.result.current.active.advancedFilters).toEqual(settings);
  act(() => first.result.current.update(duplicate!, { advancedFilters: { ...settings, countries: "GB" } }));
  act(() => first.result.current.select("old"));
  expect(first.result.current.active.advancedFilters).toEqual(settings);
  await waitFor(() => expect(getSettingsState().settings.dialMemory.pinned[0].advancedFilters).toEqual(settings));
  first.unmount();
  const restored = renderHook(() => useDialMemory());
  expect(restored.result.current.active).toMatchObject({ id: "old", advancedFilters: settings, searchSort: "qualityDesc" });
});


it("keeps batched edits to the active preset and its durable settings", async () => {
  const preset = { id: "batched", mode: "files", query: "before", searchSort: "ready" };
  localStorage.setItem("forever.dial-memory.v1", JSON.stringify({ pinned: [preset], recent: [] }));
  acceptSettings({ ...defaultSettings(), ...readLegacySettings(), webviewMigrated: true });
  const { result } = renderHook(() => useDialMemory());
  act(() => {
    result.current.update("batched", { query: "after" });
    result.current.update("batched", { searchSort: "qualityDesc" });
  });
  expect(result.current.active).toMatchObject({ query: "after", searchSort: "qualityDesc" });
  await waitFor(() => expect(getSettingsState().settings.dialMemory.pinned[0]).toMatchObject({ query: "after", searchSort: "qualityDesc" }));
});
