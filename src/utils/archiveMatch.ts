import type { ArchiveAlbumMatch } from "../types";

export function archiveMatchReason(match?: ArchiveAlbumMatch): string {
  if (match?.ownership !== "owned") return "Ownership has not been confirmed";
  if (match.matchMethod === "releaseGroupMbid") return "Release-group MBID match";
  if (match.matchMethod === "normalizedTitle") return "Normalized artist/title match";
  return "Match reason unavailable";
}
