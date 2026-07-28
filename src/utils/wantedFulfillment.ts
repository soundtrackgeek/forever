import type { Transfer, WantedAlbum, WantedDownloadFulfillment } from "../types";
import { isAudioTransfer, summarizeSoundcheck } from "./soundcheck";
import { groupTransfers } from "./transfers";

type WantedIdentity = Pick<WantedAlbum, "artist" | "title" | "firstReleaseDate">;

export const wantedAlbumDownloadTitle = (album: WantedIdentity) => {
  const year = album.firstReleaseDate.match(/^\d{4}/)?.[0];
  return `${album.artist} - ${album.title}${year ? ` (${year})` : ""}`;
};

const normalizedTitle = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const verifiedAfterWatchStarted = (album: WantedAlbum, transfers: Transfer[]) => {
  const verifiedAtMs = Math.max(
    0,
    ...transfers.map((transfer) => transfer.verifiedAtMs ?? 0),
  );
  return verifiedAtMs >= album.addedAtMs;
};

const releasePassedVerification = (transfers: Transfer[]) => {
  if (!transfers.length || transfers.some((transfer) => transfer.status !== "completed")) {
    return false;
  }

  const audio = transfers.filter(isAudioTransfer);
  if (!audio.length || audio.some((transfer) => transfer.verificationStatus !== "verified")) {
    return false;
  }

  const expectedTrackCount = transfers.find(
    (transfer) => Boolean(transfer.expectedTrackCount),
  )?.expectedTrackCount ?? null;
  if (expectedTrackCount && audio.length !== expectedTrackCount) return false;

  const soundcheck = summarizeSoundcheck(transfers);
  return soundcheck.checkedCount === 0 || soundcheck.state === "passed";
};

const transferFormat = (transfer: Transfer) => {
  const extension = transfer.remoteFilename.split(".").pop()?.trim().toLocaleUpperCase();
  return transfer.soundcheck?.codec?.trim().toLocaleUpperCase() || extension || "Audio";
};

export function verifiedDownloadedWantedFulfillments(
  albums: WantedAlbum[],
  transfers: Transfer[],
): WantedDownloadFulfillment[] {
  if (!albums.length || !transfers.length) return [];

  const verifiedGroups = groupTransfers(transfers).filter((group) =>
    releasePassedVerification(group.transfers)
  );

  return albums.flatMap((album) => {
    if (album.fulfilled) return [];
    const albumId = album.albumId.toLocaleLowerCase();
    const expectedTitle = normalizedTitle(wantedAlbumDownloadTitle(album));
    const group = verifiedGroups.find((candidate) => {
      if (!candidate.releaseId) return false;
      if (!verifiedAfterWatchStarted(album, candidate.transfers)) return false;
      const releaseGroupIds = new Set(
        candidate.transfers.flatMap((transfer) =>
          transfer.releaseGroupId ? [transfer.releaseGroupId.toLocaleLowerCase()] : []
        ),
      );
      return releaseGroupIds.size
        ? releaseGroupIds.has(albumId)
        : normalizedTitle(candidate.title) === expectedTitle;
    });
    if (!group?.releaseId) return [];

    const audio = group.transfers.filter(isAudioTransfer);
    const formats = [...new Set(audio.map(transferFormat))].sort();
    const soundcheck = summarizeSoundcheck(group.transfers);
    return [{
      albumId: album.albumId,
      releaseId: group.releaseId,
      username: group.username,
      format: formats.join(" + "),
      trackCount: audio.length,
      sizeBytes: group.sizeBytes,
      soundcheck: soundcheck.checkedCount > 0 ? "passed" : "notChecked",
      completedAtMs: Math.max(
        0,
        ...group.transfers.map((transfer) => transfer.verifiedAtMs ?? transfer.updatedAtMs),
      ),
    }];
  });
}
