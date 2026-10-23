import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDialMemory } from "./useDialMemory";
import { defaultAdvancedFilters } from "../utils/searchResults";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));

it("migrates pinned presets and retains advanced filters through switching, duplication and restart", () => {
  localStorage.setItem("forever.dial-memory.v1", JSON.stringify({ pinned: [{ id: "old", mode: "files", query: "album", searchSort: "ready" }], recent: [] }));
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
  first.unmount();
  const restored = renderHook(() => useDialMemory());
  expect(restored.result.current.active).toMatchObject({ id: "old", advancedFilters: settings, searchSort: "qualityDesc" });
});
