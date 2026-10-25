import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverySourceKey, useDiscoveryShelf, MAX_STEER, type DiscoveryArtist, type DiscoveryShelf } from "./useDiscoveryShelf";
import type { ArchiveArtistSummary } from "../types";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
const artist = (id: string): DiscoveryArtist => ({ artistId: id, name: id, disambiguation: null, score: 1, because: [], sources: [] });
const owned = (name: string, artistId: string | null = null): ArchiveArtistSummary => ({ name, ownedAlbumCount: 3, firstYear: null, lastYear: null, artistId, canonicalName: null, cachedReleaseCount: 0, catalogFetchedAt: null });
const shelf: DiscoveryShelf = { artists: [artist("a"), artist("b")], seeds: [], notices: [], unresolvedArtists: 0 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
describe("discovery shelf", () => {
  beforeEach(() => invoke.mockReset());
  it("does not send artist identities before an explicit discovery action", () => {
    renderHook(() => useDiscoveryShelf("source"));
    expect(invoke).not.toHaveBeenCalled();
  });
  it("ignores late albums after selecting another artist", async () => {
    const late = deferred<unknown>();
    invoke.mockResolvedValueOnce(shelf).mockReturnValueOnce(late.promise).mockResolvedValueOnce({ albums: [], basis: "catalog", notices: ["B result"] });
    const { result } = renderHook(() => useDiscoveryShelf("source"));
    await act(() => result.current.load());
    let pending!: Promise<void>;
    act(() => { pending = result.current.select(artist("a")); });
    await act(() => result.current.select(artist("b")));
    await act(async () => { late.resolve({ albums: [], basis: "listenbrainz", notices: ["A result"] }); await pending; });
    expect(result.current.selected?.artistId).toBe("b");
    expect(result.current.albums?.notices).toEqual(["B result"]);
  });
  it("clears a previous source and rejects its late response, even on switching back", async () => {
    const late = deferred<DiscoveryShelf>();
    invoke.mockReturnValueOnce(late.promise);
    const { result, rerender } = renderHook(({ source }) => useDiscoveryShelf(source), { initialProps: { source: "a" } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.load(); });
    rerender({ source: "b" });
    expect(result.current.shelf).toBeNull();
    rerender({ source: "a" });
    await act(async () => { late.resolve(shelf); await pending; });
    expect(result.current.shelf).toBeNull();
  });
  it("surfaces failures and recovers on retry", async () => {
    invoke.mockRejectedValueOnce("Archive unavailable").mockResolvedValueOnce(shelf);
    const { result } = renderHook(() => useDiscoveryShelf("source"));
    await act(() => result.current.load());
    expect(result.current.error).toBe("Archive unavailable");
    await act(() => result.current.load());
    expect(result.current.error).toBeNull();
    expect(result.current.shelf?.artists).toHaveLength(2);
  });
  it("steers discovery with the chosen Archive artists and names the album lookup", async () => {
    invoke.mockResolvedValue(shelf);
    const { result } = renderHook(() => useDiscoveryShelf("source"));
    act(() => { result.current.addSteer(owned("Richard Marx")); result.current.addSteer(owned("richard marx")); result.current.addSteer(owned("Queen", "q-id")); });
    expect(result.current.steer.map((item) => item.name)).toEqual(["Richard Marx", "Queen"]);
    await act(() => result.current.load());
    expect(invoke).toHaveBeenLastCalledWith("discovery_shelf", { seeds: [{ artistId: null, name: "Richard Marx" }, { artistId: "q-id", name: "Queen" }] });
    expect(result.current.steer).toHaveLength(2);
    await act(() => result.current.select(artist("a")));
    expect(invoke).toHaveBeenLastCalledWith("discovery_albums", { artistId: "a", name: "a" });
    act(() => result.current.removeSteer(result.current.steer[0]));
    expect(result.current.steer.map((item) => item.name)).toEqual(["Queen"]);
  });
  it("uses automatic seeds when no artist is chosen and caps chosen artists", async () => {
    invoke.mockResolvedValue(shelf);
    const { result } = renderHook(() => useDiscoveryShelf("source"));
    await act(() => result.current.load());
    expect(invoke).toHaveBeenLastCalledWith("discovery_shelf", { seeds: null });
    act(() => { for (let i = 0; i < MAX_STEER + 2; i += 1) result.current.addSteer(owned(`Artist ${i}`)); });
    expect(result.current.steer).toHaveLength(MAX_STEER);
  });
  it("forgets chosen artists when the Archive source changes", () => {
    const { result, rerender } = renderHook(({ source }) => useDiscoveryShelf(source), { initialProps: { source: "a" } });
    act(() => result.current.addSteer(owned("Queen")));
    rerender({ source: "b" });
    expect(result.current.steer).toEqual([]);
  });
  it("saves and clears source keys through the native commands without echoing them back", async () => {
    const status = { lastFm: { configured: true, origin: "keyring" }, discogs: { configured: false, origin: "none" }, fanart: { configured: false, origin: "none" } };
    invoke.mockResolvedValue(status);
    const { result } = renderHook(() => useDiscoveryShelf("source"));
    await act(() => result.current.saveSource("lastFm", "abcdef123456"));
    expect(invoke).toHaveBeenLastCalledWith("discovery_save_source", { source: "lastFm", key: "abcdef123456", secret: null });
    expect(result.current.sources?.lastFm.configured).toBe(true);
    expect(JSON.stringify(result.current.sources)).not.toContain("abcdef");
    await act(() => result.current.clearSource("lastFm"));
    expect(invoke).toHaveBeenLastCalledWith("discovery_clear_source", { source: "lastFm" });
  });
  it("keeps the shelf when Archive matching only refreshes the database modified time", async () => {
    invoke.mockResolvedValue(shelf);
    const status = { path: "C:/music-library.sqlite3", connected: true, lastModifiedAtMs: 1 };
    const { result, rerender } = renderHook(({ key }) => useDiscoveryShelf(key), { initialProps: { key: discoverySourceKey(status) } });
    await act(() => result.current.load());
    await act(() => result.current.select(artist("a")));
    rerender({ key: discoverySourceKey({ ...status, lastModifiedAtMs: 2 }) });
    expect(result.current.shelf?.artists).toHaveLength(2);
    expect(result.current.selected?.artistId).toBe("a");
    rerender({ key: discoverySourceKey({ ...status, path: "D:/other.sqlite3" }) });
    expect(result.current.shelf).toBeNull();
    expect(discoverySourceKey(null)).toBe(":false");
  });
});
