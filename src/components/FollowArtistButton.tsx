import { useState } from "react";
import type { useReleaseRadar } from "../hooks/useReleaseRadar";

export function FollowArtistButton({ radar, artistId, name }: { radar: ReturnType<typeof useReleaseRadar>; artistId: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const followed = radar.snapshot.artists.some((a) => a.artistId === artistId);
  const toggle = async () => {
    setError(null);
    try { await (followed ? radar.unfollow(artistId) : radar.follow(artistId, name)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <span className="artist-follow-control"><button type="button" aria-pressed={followed} disabled={!radar.ready || radar.pending} onClick={() => void toggle()}>{followed ? "Following artist" : "Follow artist"}</button>{error ? <small role="alert">{error}</small> : null}</span>;
}
