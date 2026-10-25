import { ArrowRight, ArrowsClockwise, CircleNotch, Compass, MagnifyingGlass, Plus, Record, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { MAX_STEER } from "../hooks/useDiscoveryShelf";
import type { useDiscoveryShelf, DiscoveryAlbum, DiscoveryArtist, DiscoveryAlbums, SourceKey, SourceReport, SourcesStatus } from "../hooks/useDiscoveryShelf";
import type { AlbumReleaseGroup, ArchiveArtistSummary, WantedAlbum } from "../types";

type Props = {
  discovery: ReturnType<typeof useDiscoveryShelf>;
  connected: boolean;
  online: boolean;
  wantedReady: boolean;
  wantedAlbums: WantedAlbum[];
  onAddWanted: (artist: string, album: AlbumReleaseGroup) => Promise<unknown>;
  /** Opens one search tab per album and returns how many opened. */
  onSearchAlbums: (artist: string, albums: DiscoveryAlbum[]) => number;
};

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function Artwork({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="discovery-artwork">{url && !failed
    ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <Record size={40} weight="thin" />}</span>;
}

function SeedPicker({ discovery, connected }: { discovery: Props["discovery"]; connected: boolean }) {
  const { steer, searchArtists, addSteer, removeSteer } = discovery;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArchiveArtistSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const active = connected && query.trim().length >= 2;
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setTimeout(() => {
      searchArtists(query).then(
        (found) => { if (current) { setResults(found.slice(0, 8)); setError(null); } },
        (cause) => { if (current) { setResults([]); setError(errorText(cause)); } },
      );
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [active, query, searchArtists]);
  const chosen = new Set(steer.map((item) => item.artistId ?? item.name.toLocaleLowerCase()));
  const open = !active ? [] : results.filter((artist) => !chosen.has(artist.artistId ?? artist.name.toLocaleLowerCase()));
  const full = steer.length >= MAX_STEER;
  return <div className="discovery-steer">
    <label htmlFor="discovery-seed-search"><small>Start from artists you own</small></label>
    <div className="discovery-search">
      <MagnifyingGlass size={15} />
      <input id="discovery-seed-search" type="search" autoComplete="off" value={query} disabled={!connected || full}
        placeholder={full ? `Up to ${MAX_STEER} artists` : "Search your Archive, e.g. Richard Marx"} onChange={(event) => setQuery(event.target.value)} />
    </div>
    {active && error ? <p className="discovery-notice" role="alert">{error}</p> : null}
    {open.length ? <ul className="discovery-search-results" aria-label="Archive artists">{open.map((artist) => <li key={artist.artistId ?? artist.name}>
      <button type="button" aria-label={`Add ${artist.canonicalName ?? artist.name}`} onClick={() => { addSteer(artist); setQuery(""); }}>
        <Plus size={13} /> <strong>{artist.canonicalName ?? artist.name}</strong><small>{artist.ownedAlbumCount} {artist.ownedAlbumCount === 1 ? "album" : "albums"}</small>
      </button>
    </li>)}</ul> : null}
    {steer.length ? <ul className="discovery-chips" aria-label="Chosen artists">{steer.map((item) => <li key={item.artistId ?? item.name}>
      <span>{item.name}</span>
      <button type="button" aria-label={`Remove ${item.name}`} onClick={() => removeSteer(item)}><X size={11} /></button>
    </li>)}</ul> : <p className="discovery-caption">No artist chosen: discovery uses your most-owned artists with a verified MusicBrainz identity.</p>}
  </div>;
}

const sourceRows: { key: SourceKey; label: string; secret?: boolean; help: string }[] = [
  { key: "lastFm", label: "Last.fm", help: "API key from last.fm/api. Finds similar artists." },
  { key: "discogs", label: "Discogs", secret: true, help: "Consumer key and secret from discogs.com/settings/developers. Confirms an artist's studio albums." },
  { key: "fanart", label: "Fanart.tv", help: "Project API key from fanart.tv. Adds an artist photo." },
];

function originText(status: SourcesStatus[SourceKey]) {
  if (!status.configured) return "Not connected";
  return status.origin === "environment" ? "Connected (.env.local, development only)" : "Connected · saved in the system credential store";
}

function SourceRow({ row, status, discovery }: { row: (typeof sourceRows)[number]; status: SourcesStatus[SourceKey]; discovery: Props["discovery"] }) {
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); setKey(""); setSecret(""); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <li>
    <div><strong>{row.label}</strong><small>{originText(status)}</small><small>{row.help}</small></div>
    <form onSubmit={(event) => { event.preventDefault(); void run(() => discovery.saveSource(row.key, key, row.secret ? secret : undefined)); }}>
      <input type="password" autoComplete="off" aria-label={`${row.label} ${row.secret ? "consumer key" : "API key"}`} placeholder={row.secret ? "Consumer key" : "API key"} value={key} onChange={(event) => setKey(event.target.value)} />
      {row.secret ? <input type="password" autoComplete="off" aria-label={`${row.label} consumer secret`} placeholder="Consumer secret" value={secret} onChange={(event) => setSecret(event.target.value)} /> : null}
      <button type="submit" disabled={busy || !key.trim() || (row.secret === true && !secret.trim())}>Save</button>
      {status.configured && status.origin === "keyring" ? <button type="button" disabled={busy} onClick={() => void run(() => discovery.clearSource(row.key))}>Remove</button> : null}
    </form>
    {error ? <p className="discovery-notice" role="alert">{error}</p> : null}
  </li>;
}

function SourcesPanel({ discovery }: { discovery: Props["discovery"] }) {
  const { sources, loadSources } = discovery;
  useEffect(() => { void loadSources(); }, [loadSources]);
  return <details className="discovery-sources">
    <summary>Sources{sources ? ` · ${sourceRows.filter((row) => sources[row.key].configured).length} of ${sourceRows.length} connected` : ""}</summary>
    <p className="discovery-caption">ListenBrainz and MusicBrainz need no key. Add keys to widen the search; they stay in your system credential store and are sent only to their own service.</p>
    {sources ? <ul>{sourceRows.map((row) => <SourceRow key={row.key} row={row} status={sources[row.key]} discovery={discovery} />)}</ul> : null}
  </details>;
}

function reportText(label: string, report: SourceReport) {
  switch (report.status) {
    case "found": return `${label}: ${report.count} studio ${report.count === 1 ? "album" : "albums"}`;
    case "empty": return `${label}: no studio albums found`;
    case "notConfigured": return `${label}: not connected (add a key under Sources)`;
    default: return `${label}: unavailable${report.message ? ` · ${report.message}` : ""}`;
  }
}

function AlbumPicks({ artist, result, online, wantedReady, wantedAlbums, onAddWanted, onSearchAlbums }: Omit<Props, "discovery" | "connected"> & { artist: DiscoveryArtist; result: DiscoveryAlbums }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<string | null>(null);
  async function add(album: DiscoveryAlbum) {
    setPending(album.id); setError(null);
    try { await onAddWanted(artist.name, { id: album.id, title: album.title, firstReleaseDate: album.firstReleaseDate, primaryType: "Album", secondaryTypes: [], coverArtUrl: album.coverArtUrl }); }
    catch (cause) { setError(errorText(cause)); }
    finally { setPending(null); }
  }
  function toggle(id: string) {
    setOpened(null);
    setChecked((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  }
  function search() {
    const chosen = result.albums.filter((album) => checked.has(album.id));
    const count = onSearchAlbums(artist.name, chosen);
    setOpened(count === chosen.length
      ? `Opened ${count} ${count === 1 ? "search" : "searches"} in Search.`
      : `Opened ${count} of ${chosen.length} searches. Close some search tabs to open the rest.`);
    setChecked(new Set(chosen.slice(count).map((album) => album.id)));
  }
  const none = !result.albums.length;
  return <>
    <ul className="discovery-verify" aria-label="Album checks">
      <li data-status={result.musicbrainz.status}>{reportText("MusicBrainz", result.musicbrainz)}</li>
      <li data-status={result.discogs.status}>{reportText("Discogs", result.discogs)}</li>
    </ul>
    <p className="discovery-caption">{result.basis === "listenbrainz" ? "MusicBrainz albums ranked by ListenBrainz listens; the rest follow release date." : "Studio albums ordered by release date."} Live, compilation and single releases are left out.</p>
    {result.notices.map((notice) => <p className="discovery-notice" role="status" key={notice}>{notice}</p>)}
    {error ? <p className="discovery-notice" role="alert">{error}</p> : null}
    {none ? <p className="discovery-empty">Neither MusicBrainz nor Discogs lists a studio album for this artist, so there is nothing to search for yet.</p> : null}
    {!none ? <div className="discovery-bulk">
      <button type="button" onClick={() => setChecked(checked.size === result.albums.length ? new Set() : new Set(result.albums.map((album) => album.id)))}>{checked.size === result.albums.length ? "Clear selection" : "Select all"}</button>
      <button type="button" className="discovery-primary" disabled={!online || checked.size === 0} title={online ? undefined : "Connect to Soulseek to search"} onClick={search}>
        Search Soulseek{checked.size ? ` (${checked.size})` : ""} <ArrowRight size={14} />
      </button>
    </div> : null}
    {opened ? <p className="discovery-notice" role="status">{opened}</p> : null}
    <ul className="discovery-albums">{result.albums.map((album) => {
      const wanted = wantedAlbums.some((item) => item.albumId === album.id);
      return <li key={album.id} data-checked={checked.has(album.id)}>
        <label>
          <input type="checkbox" checked={checked.has(album.id)} onChange={() => toggle(album.id)} aria-label={`Select ${album.title}`} />
          <Artwork url={album.coverArtUrl} />
          <span><small>{album.firstReleaseDate.slice(0, 4) || "Year unknown"}</small><b>{album.title}</b>
            <em>{album.musicbrainz && album.discogs ? "MusicBrainz · Discogs" : album.musicbrainz ? "MusicBrainz" : "Discogs"}</em></span>
        </label>
        <button type="button" disabled={!album.musicbrainz || !wantedReady || wanted || pending !== null}
          title={album.musicbrainz ? undefined : "Wanted needs a MusicBrainz match"} onClick={() => void add(album)}>
          {wanted ? "In Wanted" : pending === album.id ? "Adding…" : "Add to Wanted"}
        </button>
      </li>;
    })}</ul>
    {!online ? <p className="discovery-caption">Connect to Soulseek to search. You can save albums to Wanted while offline.</p> : null}
  </>;
}

export function DiscoveryShelfWorkspace({ discovery, connected, ...actions }: Props) {
  const { shelf, selected, albums, loading, error, steer } = discovery;
  const label = steer.length ? "Discover new artists" : shelf ? "Refresh shelf" : "Discover from my top artists";
  return <section className="discovery-workspace" aria-label="Similar-artist discovery shelf">
    <header className="discovery-heading">
      <div><span className="discovery-kicker"><Compass size={16} /> Beyond your collection</span><h2>Find your next favourite.</h2><p>New artists, connected to the records you already own.</p></div>
      <button type="button" className="discovery-primary" disabled={!connected || loading !== "idle"} onClick={() => void discovery.load()}>
        {loading === "shelf" ? <CircleNotch className="search-spinner" size={16} /> : <ArrowsClockwise size={16} />}
        {loading === "shelf" ? "Finding artists…" : label}
      </button>
    </header>
    {discovery.preview ? <p className="discovery-notice">Browser preview · sample artists and albums.</p> : null}
    {!connected ? <p className="discovery-empty">Connect a Music Library database in the Library tab to build your discovery shelf.</p> : null}
    <SeedPicker discovery={discovery} connected={connected} />
    <SourcesPanel discovery={discovery} />
    {!shelf && connected && loading === "idle" && !error ? <div className="discovery-intro"><Compass size={44} weight="thin" /><h3>A new direction from familiar records.</h3><p>Pick one or more artists you own, or leave it empty to use your most-owned. Artists already in your Archive are never suggested.</p><p>Discovery sends artist names and MusicBrainz IDs to ListenBrainz, and to Last.fm when you add a key. Picking an artist then checks MusicBrainz and Discogs for studio albums.</p></div> : null}
    {loading === "shelf" ? <p className="discovery-empty" role="status">Reading your Archive and following its strongest artist connections…</p> : null}
    {error ? <div className="discovery-notice" role="alert">{error}{selected ? <button type="button" onClick={() => void discovery.select(selected)}>Retry albums</button> : null}</div> : null}
    {shelf ? <>
      <div className="discovery-seeds"><small>Inspired by</small>{shelf.seeds.map((seed) => <span key={seed.artistId}>{seed.name} <b>{seed.ownedAlbumCount} albums</b></span>)}</div>
      {!steer.length && shelf.unresolvedArtists > 0 ? <p className="discovery-caption">{shelf.unresolvedArtists.toLocaleString()} Archive {shelf.unresolvedArtists === 1 ? "artist lacks" : "artists lack"} a verified MusicBrainz identity. These were not used as automatic seeds; search for one above to follow it by name, or verify identities in Music Library.</p> : null}
      {shelf.notices.map((notice) => <p className="discovery-notice" role="status" key={notice}>{notice}</p>)}
      {!shelf.artists.length ? <p className="discovery-empty">{shelf.seeds.length ? "No new artists were returned outside your collection. Try another artist or add a Last.fm key." : "No seed artists are available. Search for an artist above, or verify artist identities in Music Library."}</p> : <div className="discovery-layout">
        <ol className="discovery-artists" aria-label="Recommended artists">{shelf.artists.map((artist, index) => <li key={artist.artistId}>
          <button type="button" aria-pressed={selected?.artistId === artist.artistId} onClick={() => void discovery.select(artist)}>
            <span className="discovery-rank">{String(index + 1).padStart(2, "0")}</span>
            <span><strong>{artist.name}</strong>{artist.disambiguation ? <small>{artist.disambiguation}</small> : null}<em>Because you own {artist.because.map((seed) => seed.name).join(" · ")}</em><small>{artist.sources.join(" · ")}</small></span>
            <ArrowRight size={17} />
          </button>
        </li>)}</ol>
        <section className="discovery-picks" aria-label="Artist album picks">
          {selected ? <><span className="discovery-kicker">Studio albums</span><div className="discovery-picks-title">{albums?.imageUrl ? <img src={albums.imageUrl} alt="" /> : null}<h3>{selected.name}</h3></div>{loading === "albums" ? <p role="status"><CircleNotch className="search-spinner" size={16} /> Checking MusicBrainz and Discogs…</p> : albums ? <AlbumPicks key={selected.artistId} artist={selected} result={albums} {...actions} /> : null}</> : <div className="discovery-empty"><Record size={42} weight="thin" /><h3>Check an artist before you search.</h3><p>Select an artist to see their studio albums on MusicBrainz and Discogs, then search for the ones you want.</p></div>}
        </section>
      </div>}
      <p className="discovery-caption">Artist connections: ListenBrainz listening sessions and Last.fm similar artists, weighted by your owned album counts. This is listening affinity, not an audio or genre analysis. Provider results are cached for seven days.</p>
    </> : null}
  </section>;
}
