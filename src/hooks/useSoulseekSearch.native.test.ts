import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchEvent, SearchSnapshot } from "../types";
import { useSoulseekSearch } from "./useSoulseekSearch";

const { invoke, events } = vi.hoisted(() => ({
  invoke: vi.fn(),
  events: new Map<string, (event: { payload: SearchEvent }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => { events.set(name, callback); return () => events.delete(name); }),
}));
const snapshot = (token = 1, query = "bjork debut"): SearchSnapshot => ({
  state: "searching", token, query, clientId: "album-1", resultCount: 0, peerCount: 0,
  message: "Queued", startedAtMs: null, finishedAtMs: null,
});
beforeEach(() => {
  events.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (command) => command === "search_snapshot" ? [] : snapshot());
});
describe("native album search handoff", () => {
  it("passes structured album identity to Rust while preserving typed file syntax", async () => {
    const { result, unmount } = renderHook(() => useSoulseekSearch("album-1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.startSearch("album-1", "Björk Début (Deluxe Edition)", { artist: "Björk", title: "Début (Deluxe Edition)" });
    });
    expect(invoke).toHaveBeenLastCalledWith("search_start", {
      clientId: "album-1", query: "Björk Début (Deluxe Edition)", album: { artist: "Björk", title: "Début (Deluxe Edition)" },
    });
    expect(result.current.snapshot.query).toBe("bjork debut");
    await act(async () => { await result.current.startSearch("files", "  Björk -live *debut  "); });
    expect(invoke).toHaveBeenLastCalledWith("search_start", { clientId: "files", query: "Björk -live *debut" });
    unmount();
    expect(events.size).toBe(0);
  });

  it("keeps fallback progress on its album and rejects replies from the previous token", async () => {
    const { result } = renderHook(() => useSoulseekSearch("album-1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.startSearch("album-1", "Björk Début", { artist: "Björk", title: "Début" }); });
    const fallback = { ...snapshot(2, "debut"), message: "No matches. Queued Album query 2/2: debut" };
    act(() => events.get("forever://search")!({ payload: { event: "started", snapshot: fallback, results: [] } }));
    act(() => events.get("forever://search")!({ payload: { event: "completed", snapshot: { ...snapshot(1), state: "completed" }, results: [] } }));
    expect(result.current.snapshot).toEqual(fallback);
    expect(result.current.results).toHaveLength(0);
    act(() => events.get("forever://search")!({ payload: { event: "completed", snapshot: { ...fallback, state: "completed" }, results: [] } }));
    expect(result.current.snapshot.state).toBe("completed");
    expect(result.current.snapshot.token).toBe(2);
  });
});
