import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { AlbumReleaseGroup, ArchiveAlbumMatch, ArchiveMatchResponse, ArchiveStatus, WantedAlbum } from "../types";
import { groupTransfers, type TransferGroup } from "../utils/transfers";
import { useArchiveInventory } from "./useArchiveInventory";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

const status: ArchiveStatus = { path: "C:\\old.db", pathSource: "automatic", settingsNotice: null, connected: true, readOnly: true, albumCount: 1, trackCount: 10, lastImportedAt: null, lastModifiedAtMs: null, error: null };
const nextStatus: ArchiveStatus = { ...status, path: "D:\\new.db", pathSource: "custom" };
const mbid = "12fa3845-7c62-36e5-a8da-8be137155a72";
const albums: AlbumReleaseGroup[] = [{ id: mbid, title: "Hysteria", firstReleaseDate: "1987", primaryType: "Album", secondaryTypes: [], coverArtUrl: "" }];
const wanted: WantedAlbum[] = [];
const emptyAlbums: AlbumReleaseGroup[] = [];
const groups: TransferGroup[] = [];
const owned: ArchiveAlbumMatch = { albumId: mbid, ownership: "owned", matchMethod: "releaseGroupMbid", matchedReleaseGroupId: mbid, localAlbumId: "old-local", localTitle: "Hysteria", localArtist: "Def Leppard", localYear: 1987, trackCount: 12 };

describe("Archive source changes", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it("discards old matching replies after changing the database", async () => {
    let resolveOld!: (value: ArchiveMatchResponse) => void;
    const old = new Promise<ArchiveMatchResponse>((resolve) => { resolveOld = resolve; });
    let calls = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "archive_status") return status;
      if (command === "archive_set_database_path") return nextStatus;
      if (command === "archive_match_albums") return ++calls === 1 ? old : { source: nextStatus, matches: [] };
      throw new Error(command);
    });
    const { result } = renderHook(() => useArchiveInventory("Def Leppard", albums, wanted, groups));
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => { await result.current.selectDatabase(nextStatus.path); });
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => { resolveOld({ source: status, matches: [owned] }); });
    expect(result.current.status?.path).toBe(nextStatus.path);
    expect(result.current.matchByAlbumId.size).toBe(0);
    expect(result.current.matching).toBe(false);
  });

  it("sends transfer release-group identity separately from the download id", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => command === "archive_status" ? status : { source: status, matches: [] });
    const transfers = groupTransfers([{
      id: "track", releaseId: "download-id", releaseGroupId: mbid,
      releaseTitle: "Unparseable display name", searchAlbum: { artist: "Def Leppard", title: "Hysteria" },
      title: "track.flac", username: "peer", remoteFilename: "track.flac", sizeBytes: 10,
      transferredBytes: 10, speedBytesPerSecond: 0, etaSeconds: 0, status: "completed",
      queuePosition: null, localPath: "C:\\track.flac", error: null, createdAtMs: 1, updatedAtMs: 1,
    }]);
    renderHook(() => useArchiveInventory(null, emptyAlbums, wanted, transfers));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("archive_match_wanted", {
      albums: [{ id: "download-id", releaseGroupId: mbid, artist: "Def Leppard", title: "Hysteria", firstReleaseDate: "" }],
    }));
  });
});
