import type { TransferGroup } from "./transfers";

export type ReleaseIdentity = {
  releaseGroupId: string | null;
  artist: string;
  title: string;
};

// "(1984)", "[FLAC]", "(Deluxe Edition)" — release-folder decoration that only hurts a catalog match.
const trailingTags = /\s*[([][^)\]]*[)\]]\s*$/;

const stripTags = (value: string) => {
  let current = value.trim();
  for (let pass = 0; pass < 4 && trailingTags.test(current); pass += 1) {
    const next = current.replace(trailingTags, "").trim();
    if (!next) break;
    current = next;
  }
  return current;
};

/** Best guess at which album a transfer group is, from the search that started it or its folder name. */
export const releaseIdentityForGroup = (group: TransferGroup): ReleaseIdentity | null => {
  const releaseGroupId = group.transfers.find((transfer) => transfer.releaseGroupId)?.releaseGroupId ?? null;
  const searched = group.transfers.find((transfer) => transfer.searchAlbum)?.searchAlbum;
  if (searched?.artist && searched.title) return { releaseGroupId, artist: searched.artist, title: searched.title };
  const separator = group.title.indexOf(" - ");
  if (separator > 0) {
    const artist = group.title.slice(0, separator).trim();
    const title = stripTags(group.title.slice(separator + 3));
    if (artist && title) return { releaseGroupId, artist, title };
  }
  const artist = group.transfers[0]?.remoteFilename.split(/[\\/]/).slice(-3, -2)[0]?.trim();
  const title = stripTags(group.title);
  if (artist && title) return { releaseGroupId, artist, title };
  return releaseGroupId ? { releaseGroupId, artist: "", title } : null;
};

export const coverUrlForReleaseGroup = (releaseGroupId: string) =>
  `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
