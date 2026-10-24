import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowsClockwise, BellRinging, Record } from "@phosphor-icons/react";
import type { AlbumReleaseGroup, ArchiveArtistsResponse, WantedAlbum } from "../types";
import type { RadarRelease, useReleaseRadar } from "../hooks/useReleaseRadar";
import { FollowArtistButton } from "./FollowArtistButton";

type Props = { radar: ReturnType<typeof useReleaseRadar>; sourceKey: string; archiveConnected: boolean; wanted: WantedAlbum[]; wantedReady: boolean; onAddWanted: (artist: string, album: AlbumReleaseGroup) => Promise<unknown>; onSearchArtists: () => void };
type Suggestion = { artistId: string; name: string; count: number };
const mbid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ArchiveSuggestions({ radar, archiveConnected, sourceKey }: Pick<Props, "radar" | "archiveConnected" | "sourceKey">) {
  const [result, setResult] = useState<{ artists: Suggestion[]; note: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; }, [sourceKey]);
  const load = async () => {
    const request = ++sequence.current; setLoading(true); setError(null);
    try {
      const response = radar.preview ? null : await invoke<ArchiveArtistsResponse>("archive_artists", { query: "" });
      if (request !== sequence.current) return;
      if (response && !response.source.connected) throw new Error(response.source.error || "Archive unavailable.");
      const seen = new Set<string>();
      const artists = response ? response.artists.flatMap((artist) => {
        const id = artist.artistId?.toLowerCase();
        if (!id || !mbid.test(id) || id === "89ad4ac3-39f7-470e-963a-56509c546377" || seen.has(id)) return [];
        seen.add(id); return [{ artistId: id, name: artist.canonicalName || artist.name, count: artist.ownedAlbumCount }];
      }).sort((a, b) => b.count - a.count).slice(0, 12) : [{ artistId: "0383dadf-2a4e-4d10-a46a-e9e041da8eb3", name: "Queen", count: 19 }, { artistId: "7249b899-8db8-43e7-9e6e-22f1e736024e", name: "Def Leppard", count: 8 }];
      setResult({ artists, note: response?.truncated ? "Suggestions use the first 120 Archive artists. Use album search to follow any other artist." : "Only verified MusicBrainz identities are suggested. Review missing identities in Music Library." });
    } catch (e) { if (request === sequence.current) setError(String(e)); }
    finally { if (request === sequence.current) setLoading(false); }
  };
  return <div className="release-radar-suggestions">
    <button type="button" disabled={!archiveConnected || loading} onClick={() => void load()}>{loading ? "Reading Archive…" : "Suggest from Archive"}</button>
    {!archiveConnected ? <small>Connect your Music Library in Archive to suggest artists.</small> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result ? <><p>{result.note}</p>{!result.artists.length ? <p>No verified artists found. Find an artist through album search to follow them.</p> : <ul>{result.artists.map((artist) => <li key={artist.artistId}><span>{artist.name} <small>{artist.count} owned albums</small></span><FollowArtistButton radar={radar} artistId={artist.artistId} name={artist.name} /></li>)}</ul>}</> : null}
  </div>;
}

export function NewReleaseRadar({ radar, sourceKey, archiveConnected, wanted, wantedReady, onAddWanted, onSearchArtists }: Props) {
  const [manage, setManage] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(12);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const { snapshot } = radar;
  const nextManualCheck = snapshot.artists.length ? Math.min(...snapshot.artists.map((artist) => artist.lastAttemptAtMs === null ? 0 : artist.lastAttemptAtMs + 900_000)) : 0;
  const coolingDown = !radar.preview && nextManualCheck > now;
  const items = snapshot.releases.filter((r) => r.dismissed === dismissed);
  const action = async (id: string, operation: () => Promise<unknown>) => {
    setPending(id); setError(null);
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(null); }
  };
  const releaseLabel = (release: RadarRelease) => {
    const date = release.album.firstReleaseDate;
    if (date.length < 10) return `${date} · date incomplete`;
    return `${date > new Date().toISOString().slice(0, 10) ? "Upcoming · " : ""}${date}`;
  };
  return <section className="release-radar" aria-label="New Release Radar">
    <header><div><span className="release-radar-kicker"><BellRinging size={16} /> From the artists you follow</span><h2>New Release Radar</h2><p>Recent records and the next ones to look forward to.</p></div><div className="release-radar-actions">
      <button type="button" aria-expanded={manage} onClick={() => setManage(!manage)}>Following {snapshot.artists.length}</button>
      <button type="button" disabled={Boolean(snapshot.checking) || radar.pending || (radar.ready && (!snapshot.artists.length || coolingDown))} onClick={() => void radar.refresh()}><ArrowsClockwise size={16} /> {snapshot.checking ? "Checking…" : coolingDown ? `Check in ${Math.ceil((nextManualCheck - now) / 60_000)}m` : radar.ready ? "Check releases" : "Retry loading"}</button>
    </div></header>
    <p className="release-radar-caption">Albums, EPs and singles · past 90 days and next 90 days · checked daily while Forever is open. Manual checks have a 15-minute cooldown per artist.</p>
    {radar.preview ? <p className="release-radar-notice">Browser preview · fictional release and sample Archive suggestions. No provider requests or automatic Wanted additions.</p> : null}
    {snapshot.checking ? <p role="status">Checking {snapshot.checking}…</p> : null}
    {[error, radar.error, snapshot.error, ...snapshot.notices.map((n) => n.message)].filter(Boolean).map((notice, i) => <p role="alert" className="release-radar-notice" key={i}>{notice}</p>)}
    {snapshot.artists.some((a) => a.error) && !manage ? <p className="release-radar-notice">Some artists need another check. Open Following for details; previously found releases remain available.</p> : null}
    {manage ? <div className="release-radar-management">
      <div><h3>Your followed artists</h3><p>Following sends the artist’s MusicBrainz ID for daily release lookups. Up to 100 artists.</p><button type="button" onClick={onSearchArtists}>Find an artist to follow</button></div>
      {!snapshot.artists.length ? <p>No followed artists yet.</p> : <ul aria-label="Followed artists">{snapshot.artists.map((artist) => <li key={artist.artistId}>
        <div><strong>{artist.name}</strong><small>{artist.lastCheckedAtMs ? `Last checked ${new Date(artist.lastCheckedAtMs).toLocaleString()}` : "First check pending"}</small>{artist.error ? <small className="release-radar-notice">{artist.error}</small> : null}</div>
        <label><input type="checkbox" checked={artist.autoAdd} disabled={radar.pending || pending !== null} onChange={(e) => void action(artist.artistId, () => radar.follow(artist.artistId, artist.name, e.target.checked))} /> Auto-add to Wanted</label>
        <button type="button" disabled={radar.pending || pending !== null} onClick={() => void action(artist.artistId, () => radar.unfollow(artist.artistId))}>Unfollow {artist.name}</button>
      </li>)}</ul>}
      <p className="release-radar-caption">Auto-add runs on the next check using your current default Smart Match profile, including recent items already in this inbox. Dismissed, already added, and verified owned releases are skipped. Existing Wanted choices are preserved. Unfollowing removes this artist’s radar history and leaves Wanted intact.</p>
      <ArchiveSuggestions key={sourceKey} sourceKey={sourceKey} radar={radar} archiveConnected={archiveConnected} />
    </div> : null}
    <div className="release-radar-filter"><button type="button" aria-pressed={!dismissed} onClick={() => { setDismissed(false); setLimit(12); }}>Inbox {snapshot.releases.filter((r) => !r.dismissed).length}</button><button type="button" aria-pressed={dismissed} onClick={() => { setDismissed(true); setLimit(12); }}>Dismissed {snapshot.releases.filter((r) => r.dismissed).length}</button></div>
    {!items.length ? <div className="release-radar-empty"><Record size={30} /><div><h3>{dismissed ? "Nothing dismissed." : snapshot.artists.length ? "No recent releases here yet." : "Keep up with your favourite artists."}</h3><p>{dismissed ? "Dismissed releases stay here until they leave the 90-day window." : "Follow artists from album search or choose suggestions from your Archive."}</p></div><button type="button" onClick={onSearchArtists}>Find artists</button></div> : <ul className="release-radar-releases" aria-label={dismissed ? "Dismissed releases" : "Recent releases"}>{items.slice(0, limit).map((release) => {
      const existing = wanted.find((a) => a.albumId === release.album.id);
      const saved = Boolean(existing) || release.addedToWanted;
      return <li key={release.album.id}><span className="release-radar-art" aria-hidden="true"><Record size={30} /></span><div className="release-radar-release-copy"><small>{release.album.primaryType} · {releaseLabel(release)}</small><h3>{release.album.title}</h3><p>{release.artist}</p>{release.autoAddError ? <small role="alert">Could not auto-add: {release.autoAddError}</small> : null}</div>
        {release.owned || existing?.fulfilled ? <span className="release-radar-owned">In your collection</span> : <button type="button" disabled={saved || !wantedReady || pending !== null || radar.pending} onClick={() => void action(release.album.id, () => radar.addWanted(release, onAddWanted))}>{saved ? existing ? "In Wanted" : "Added to Wanted" : pending === release.album.id ? "Adding…" : "Add to Wanted"}</button>}
        <button type="button" disabled={pending !== null || radar.pending} aria-label={`${dismissed ? "Restore" : "Dismiss"} ${release.album.title}`} onClick={() => void action(release.album.id, () => radar.dismiss(release.album.id, !dismissed))}>{dismissed ? "Restore" : "Dismiss"}</button>
      </li>;
    })}</ul>}
    {items.length > limit ? <button type="button" onClick={() => setLimit(limit + 12)}>Show more releases ({items.length - limit} remaining)</button> : null}
    <p className="release-radar-caption">Source: MusicBrainz. Dates and announcements may change; incomplete dates retain their original precision. Reissues share the original release-group date. Saved discoveries remain available offline.</p>
  </section>;
}
