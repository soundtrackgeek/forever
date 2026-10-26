import { invoke } from "@tauri-apps/api/core";
import type { AlbumTrack, FolderInspection, TransferQueueSnapshot, WantedAlbum, WantedBestSource, WantedSmartState } from "../types";
import { inspectAlbumSource } from "../utils/inspectAlbumSource";
import type { SmartDeps } from "../utils/smartDownloadRunner";
import { tracklistConfidenceForInspection } from "../utils/tracklistConfidence";
import { wantedAlbumDownloadTitle } from "../utils/wantedFulfillment";

type Api = {
  officialTracks: (albumId: string, releaseId: string | null) => Promise<AlbumTrack[]>;
  save: (albumId: string, state: WantedSmartState) => Promise<unknown>;
  setAuto: (albumId: string, auto: boolean) => Promise<unknown>;
};

// Talks to the backend directly instead of through the Transfers and Folders
// hooks: a background pass must not flip their loading flags or surface its
// own failures as errors in whatever screen the person is looking at. The
// resulting snapshots still reach those hooks through the usual events.
export function createSmartDownloadDeps(api: Api): Omit<SmartDeps, "now"> {
  return {
    inspect: (_album: WantedAlbum, source: WantedBestSource) =>
      inspectAlbumSource(source.folder, source.folders ?? [], (requestedFolder) =>
        invoke<FolderInspection>("folder_inspect", { username: source.username, folder: requestedFolder })),
    officialTracks: (album) => api.officialTracks(album.albumId, album.selectedReleaseId ?? null),
    confidence: (inspection, tracks, artist) => tracklistConfidenceForInspection(inspection, tracks, artist),
    enqueue: async (album, _source, inspection, expectedTrackCount) => {
      const startedAt = Date.now();
      const snapshot = await invoke<TransferQueueSnapshot>("transfer_enqueue_release", {
        request: {
          title: wantedAlbumDownloadTitle(album),
          username: inspection.username,
          remoteFolder: inspection.requestedFolder,
          files: inspection.files.map((file) => ({ title: file.filename, remoteFilename: file.remoteFilename, sizeBytes: file.sizeBytes })),
          expectedTrackCount,
          releaseGroupId: album.albumId,
          searchAlbum: { artist: album.artist, title: album.title },
          alternatives: [],
        },
      });
      const albumId = album.albumId.toLowerCase();
      const created = snapshot.transfers
        .filter((transfer) => transfer.releaseId
          && transfer.releaseGroupId?.toLowerCase() === albumId
          && transfer.username.toLowerCase() === inspection.username.toLowerCase()
          && transfer.createdAtMs >= startedAt - 5_000)
        .sort((left, right) => right.createdAtMs - left.createdAtMs);
      return { releaseId: created[0]?.releaseId ?? null };
    },
    cancelRelease: (releaseId) => invoke("transfer_cancel_release", { releaseId }),
    save: api.save,
    // Not through useWantedAlbums: a refused check ("another album is being
    // checked") is routine here and must not raise the Wanted error banner.
    recheck: (albumId) => invoke("wanted_check", { albumId }),
    setAuto: api.setAuto,
  };
}
