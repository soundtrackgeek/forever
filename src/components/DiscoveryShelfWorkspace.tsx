import { ArrowRight, ArrowsClockwise, CircleNotch, Compass, Record } from "@phosphor-icons/react";
import { useState } from "react";
import type { useDiscoveryShelf, DiscoveryArtist, DiscoveryAlbums } from "../hooks/useDiscoveryShelf";
import type { AlbumReleaseGroup, WantedAlbum } from "../types";

type Props = {
  discovery: ReturnType<typeof useDiscoveryShelf>;
  connected: boolean;
  online: boolean;
  wantedReady: boolean;
  wantedAlbums: WantedAlbum[];
  onAddWanted: (artist: string, album: AlbumReleaseGroup) => Promise<unknown>;
  onSmartMatch: (artist: string, album: AlbumReleaseGroup) => void;
};

function Artwork({ album }: { album: AlbumReleaseGroup }) {
  const [failed, setFailed] = useState(false);
  return <span className="discovery-artwork">{album.coverArtUrl && !failed
    ? <img src={album.coverArtUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <Record size={40} weight="thin" />}</span>;
}

function AlbumPicks({ artist, result, online, wantedReady, wantedAlbums, onAddWanted, onSmartMatch }: Omit<Props, "discovery" | "connected"> & { artist: DiscoveryArtist; result: DiscoveryAlbums }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function add(album: AlbumReleaseGroup) {
    setPending(album.id); setError(null);
    try { await onAddWanted(artist.name, album); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(null); }
  }
  return <>
    <p className="discovery-caption">{result.basis === "listenbrainz" ? "Studio albums ranked by ListenBrainz listens where available; other picks follow release date." : "Studio albums from MusicBrainz, ordered by release date. Popularity data is unavailable."}</p>
    {result.notices.map((notice) => <p className="discovery-notice" role="status" key={notice}>{notice}</p>)}
    {error ? <p className="discovery-notice" role="alert">{error}</p> : null}
    {!result.albums.length ? <p className="discovery-empty">No studio albums were found for this artist in the available MusicBrainz catalog.</p> : null}
    <div className="discovery-albums">{result.albums.map((album) => {
      const wanted = wantedAlbums.some((item) => item.albumId === album.id);
      return <article key={album.id}>
        <Artwork album={album} />
        <div><small>{album.firstReleaseDate.slice(0, 4) || "Year unknown"}</small><h4>{album.title}</h4></div>
        <button type="button" disabled={!online} title={online ? "Find sources and review with Smart Match" : "Connect to Soulseek to find sources"} onClick={() => onSmartMatch(artist.name, album)}>Smart Match <ArrowRight size={14} /></button>
        <button type="button" disabled={!wantedReady || wanted || pending !== null} onClick={() => void add(album)}>{wanted ? "In Wanted" : pending === album.id ? "Adding…" : "Add to Wanted"}</button>
      </article>;
    })}</div>
    {!online ? <p className="discovery-caption">Connect to Soulseek for Smart Match. You can save albums to Wanted while offline.</p> : null}
  </>;
}

export function DiscoveryShelfWorkspace({ discovery, connected, ...actions }: Props) {
  const { shelf, selected, albums, loading, error } = discovery;
  return <section className="discovery-workspace" aria-label="Similar-artist discovery shelf">
    <header className="discovery-heading">
      <div><span className="discovery-kicker"><Compass size={16} /> Beyond your collection</span><h2>Find your next favourite.</h2><p>New artists, connected to the records you already own.</p></div>
      <button type="button" disabled={!connected || loading !== "idle"} onClick={() => void discovery.load()}>
        {loading === "shelf" ? <CircleNotch className="search-spinner" size={16} /> : <ArrowsClockwise size={16} />}
        {loading === "shelf" ? "Finding artists…" : shelf ? "Refresh shelf" : "Discover artists"}
      </button>
    </header>
    {discovery.preview ? <p className="discovery-notice">Browser preview · sample artists and albums.</p> : null}
    {!connected ? <p className="discovery-empty">Connect a Music Library database in the Library tab to build your discovery shelf.</p> : null}
    {!shelf && connected && loading === "idle" && !error ? <div className="discovery-intro"><Compass size={44} weight="thin" /><h3>A new direction from familiar records.</h3><p>Use up to five of your most-owned artists with verified MusicBrainz identities. Artists already in your Archive are excluded.</p><p>Discover artists sends those artist IDs to ListenBrainz. Album picks use MusicBrainz and ListenBrainz; no account or API key is needed.</p></div> : null}
    {loading === "shelf" ? <p className="discovery-empty" role="status">Reading your Archive and following its strongest artist connections…</p> : null}
    {error ? <div className="discovery-notice" role="alert">{error}{selected ? <button type="button" onClick={() => void discovery.select(selected)}>Retry albums</button> : null}</div> : null}
    {shelf ? <>
      <div className="discovery-seeds"><small>Inspired by your Archive</small>{shelf.seeds.map((seed) => <span key={seed.artistId}>{seed.name} <b>{seed.ownedAlbumCount} albums</b></span>)}</div>
      {shelf.unresolvedArtists > 0 ? <p className="discovery-caption">{shelf.unresolvedArtists.toLocaleString()} Archive {shelf.unresolvedArtists === 1 ? "artist lacks" : "artists lack"} a verified MusicBrainz identity. These artists were not used as seeds; verify identities in Music Library to include them.</p> : null}
      {shelf.notices.map((notice) => <p className="discovery-notice" role="status" key={notice}>{notice}</p>)}
      {!shelf.artists.length ? <p className="discovery-empty">{shelf.seeds.length ? "No new artists were returned outside your collection. Try refreshing later." : "No verified seed artists are available. Verify artist identities in Music Library, then refresh the shelf."}</p> : <div className="discovery-layout">
        <ol className="discovery-artists" aria-label="Recommended artists">{shelf.artists.map((artist, index) => <li key={artist.artistId}>
          <button type="button" aria-pressed={selected?.artistId === artist.artistId} onClick={() => void discovery.select(artist)}>
            <span className="discovery-rank">{String(index + 1).padStart(2, "0")}</span>
            <span><strong>{artist.name}</strong>{artist.disambiguation ? <small>{artist.disambiguation}</small> : null}<em>Because you own {artist.because.map((seed) => seed.name).join(" · ")}</em></span>
            <ArrowRight size={17} />
          </button>
        </li>)}</ol>
        <section className="discovery-picks" aria-label="Artist album picks">
          {selected ? <><span className="discovery-kicker">Start here</span><h3>{selected.name}</h3>{loading === "albums" ? <p role="status"><CircleNotch className="search-spinner" size={16} /> Finding albums…</p> : albums ? <AlbumPicks key={selected.artistId} artist={selected} result={albums} {...actions} /> : null}</> : <div className="discovery-empty"><Record size={42} weight="thin" /><h3>A few records to begin with.</h3><p>Select an artist for up to three studio album picks.</p></div>}
        </section>
      </div>}
      <p className="discovery-caption">Artist connections: ListenBrainz listening sessions, weighted by your owned album counts. This is listening affinity, not an audio or genre analysis. Provider results are cached for seven days.</p>
    </> : null}
  </section>;
}
