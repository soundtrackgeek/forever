import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { TransferGroup } from "../utils/transfers";
import { coverUrlForReleaseGroup, releaseIdentityForGroup } from "../utils/releaseIdentity";

// Transfer rows re-render every second, so lookups are remembered for the session.
const lookups = new Map<string, Promise<string | null>>();

const lookupCover = (artist: string, title: string) => {
  const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
  let pending = lookups.get(key);
  if (!pending) {
    pending = invoke<string | null>("album_cover_lookup", { artist, title }).catch(() => {
      lookups.delete(key);
      return null;
    });
    lookups.set(key, pending);
  }
  return pending;
};

/** Cover Art Archive URL for a transfer group, or null while unknown or when none exists. */
export function useReleaseCover(group: TransferGroup | null): string | null {
  const identity = group ? releaseIdentityForGroup(group) : null;
  const direct = identity?.releaseGroupId ? coverUrlForReleaseGroup(identity.releaseGroupId) : null;
  const artist = identity?.artist ?? "";
  const title = identity?.title ?? "";
  const [found, setFound] = useState<{ key: string; url: string } | null>(null);
  const key = `${artist}|${title}`;

  useEffect(() => {
    if (direct || !artist || !title || !isTauri()) return;
    let cancelled = false;
    void lookupCover(artist, title).then((url) => {
      if (!cancelled && url) setFound({ key, url });
    });
    return () => { cancelled = true; };
  }, [direct, artist, title, key]);

  return direct ?? (found?.key === key ? found.url : null);
}
