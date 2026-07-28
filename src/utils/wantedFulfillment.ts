import type { Transfer, WantedAlbum } from "../types";
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

export function verifiedDownloadedWantedAlbumIds(
  albums: WantedAlbum[],
  transfers: Transfer[],
) {
  if (!albums.length || !transfers.length) return [];

  const verifiedGroups = groupTransfers(transfers).filter((group) =>
    releasePassedVerification(group.transfers)
  );

  return albums.flatMap((album) => {
    const albumId = album.albumId.toLocaleLowerCase();
    const expectedTitle = normalizedTitle(wantedAlbumDownloadTitle(album));
    const fulfilled = verifiedGroups.some((group) => {
      if (!verifiedAfterWatchStarted(album, group.transfers)) return false;
      const releaseGroupIds = new Set(
        group.transfers.flatMap((transfer) =>
          transfer.releaseGroupId ? [transfer.releaseGroupId.toLocaleLowerCase()] : []
        ),
      );
      return releaseGroupIds.size
        ? releaseGroupIds.has(albumId)
        : normalizedTitle(group.title) === expectedTitle;
    });
    return fulfilled ? [album.albumId] : [];
  });
}
