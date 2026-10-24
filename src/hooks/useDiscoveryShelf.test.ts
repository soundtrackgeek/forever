import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiscoveryShelf, type DiscoveryArtist, type DiscoveryShelf } from "./useDiscoveryShelf";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
const artist = (id: string): DiscoveryArtist => ({ artistId: id, name: id, disambiguation: null, score: 1, because: [] });
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
});
