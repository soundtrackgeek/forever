import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ArchiveArtistsResponse } from "../types";
import { useMissingShelf } from "./useMissingShelf";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

it("ignores artist results from a database that was reset while loading", async () => {
  let resolve!: (value: ArchiveArtistsResponse) => void;
  vi.mocked(invoke).mockReturnValue(new Promise<ArchiveArtistsResponse>((done) => { resolve = done; }));
  const { result } = renderHook(() => useMissingShelf());
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.loadArtists(""); });
  act(() => result.current.resetSource());
  await act(async () => {
    resolve({ source: { path: "old", pathSource: "custom", settingsNotice: null, readOnly: true, connected: true, albumCount: 1, trackCount: 10, lastImportedAt: null, lastModifiedAtMs: null, error: null },
      artists: [{ name: "Old artist", ownedAlbumCount: 1, firstYear: null, lastYear: null, artistId: null, canonicalName: null, cachedReleaseCount: 0, catalogFetchedAt: null }], truncated: false });
    await pending;
  });
  expect(result.current.artists).toEqual([]);
  expect(result.current.activated).toBe(false);
  expect(result.current.loading).toBe("idle");
});
