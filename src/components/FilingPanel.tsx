import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { defaultFilingSettings, filingApi, type FilingPlan, type FilingRecord, type TrackInput, type TrackTags } from "../filing";
import { patchSettings, useSettings } from "../settings";
import type { AlbumEditions } from "../types";
import { isAudioTransfer } from "../utils/soundcheck";
import type { TransferGroup } from "../utils/transfers";

function initialTracks(group: TransferGroup | null): TrackInput[] {
  const parts = /^(.*?)\s+-\s+(.+?)(?:\s+\((\d{4})\))?$/.exec(group?.title ?? "");
  return (group?.transfers ?? []).filter(isAudioTransfer).map((t, i) => ({ transferId: t.id, tags: {
    title: t.title.replace(/\.[^.]+$/, "").replace(/^\d+[ ._-]+/, ""), artist: parts?.[1] ?? "", albumArtist: parts?.[1] ?? "", album: parts?.[2] ?? group?.title ?? "", date: parts?.[3] ?? "",
    disc: 1, track: t.soundcheck?.trackNumber ?? i + 1, releaseGroupId: t.releaseGroupId ?? null, releaseId: null, recordingId: null,
  } }));
}
const labelTags = (tags: TrackTags): [string, string][] => [
  ["Title", tags.title], ["Artist", tags.artist], ["Album artist", tags.albumArtist], ["Album", tags.album], ["Date", tags.date || "Clear"], ["Disc / track", `${tags.disc} / ${tags.track}`],
  ["Release group MBID", tags.releaseGroupId ?? "Clear"], ["Release MBID", tags.releaseId ?? "Clear"], ["Recording MBID", tags.recordingId ?? "Clear"],
];

export function FilingPanel({ group, onClose }: { group: TransferGroup | null; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const { settings } = useSettings();
  const [options, setOptions] = useState(settings.transfers.filing ?? defaultFilingSettings());
  const [tracks, setTracks] = useState(() => initialTracks(group));
  const [groupId, setGroupId] = useState(group?.transfers.find(t => t.releaseGroupId)?.releaseGroupId ?? "");
  const [editions, setEditions] = useState<AlbumEditions | null>(null);
  const [editionId, setEditionId] = useState("");
  const [official, setOfficial] = useState<TrackTags[]>([]);
  const [plan, setPlan] = useState<FilingPlan | null>(null);
  const [history, setHistory] = useState<FilingRecord[]>([]);
  const [undo, setUndo] = useState<FilingRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    panel.current?.scrollIntoView?.({ block: "start" });
    if (isTauri()) void filingApi.notices().then(r => { if (alive) setNotices(r.map(n => n.message)); }).catch(e => { if (alive) setError(String(e)); });
    if (isTauri()) void filingApi.history().then(r => { if (alive) setHistory(r); }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);
  const invalidate = () => { setPlan(null); setReviewed(false); setMessage(""); };
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const refresh = async () => setHistory(await filingApi.history());
  const editTrack = (id: string, patch: Partial<TrackTags>) => { invalidate(); setTracks(current => current.map(t => t.transferId === id ? { ...t, tags: { ...t.tags, ...patch } } : t)); };
  const chooseFolder = (key: "libraryRoot" | "incompleteDirectory") => perform(async () => {
    const selected = await open({ directory: true, multiple: false, title: key === "libraryRoot" ? "Choose library root" : "Choose incomplete folder" });
    if (typeof selected === "string") { invalidate(); setOptions(o => ({ ...o, [key]: selected })); }
  });
  return <section ref={panel} className="filing-panel" aria-label="Tagging and filing">
    <header><div><small>TAGGING & FILING</small><h3>{group ? group.title : "Filing settings & history"}</h3></div><button type="button" onClick={onClose} disabled={busy}>Close filing</button></header>
    <p>Review the tags and paths, then file a completed arrival. Original bytes stay available for undo. Music Library remains read-only.</p>
    {error && <p role="alert" className="filing-error">{error}</p>}
    {notices.map(notice => <p key={notice} role="status" className="filing-error">{notice}</p>)}
    {message && <p role="status" className="filing-success">{message}</p>}
    <fieldset disabled={busy}>
      <legend>Folders and naming</legend>
      <div className="filing-fields">
        <label>Library root<div className="filing-path"><input value={options.libraryRoot} onChange={e => { invalidate(); setOptions(o => ({ ...o, libraryRoot: e.target.value })); }} placeholder="C:\Music" /><button type="button" onClick={() => void chooseFolder("libraryRoot")}>Browse library</button></div></label>
        <label>Incomplete folder (optional)<div className="filing-path"><input value={options.incompleteDirectory ?? ""} onChange={e => { invalidate(); setOptions(o => ({ ...o, incompleteDirectory: e.target.value || null })); }} placeholder="Use download folder" /><button type="button" onClick={() => void chooseFolder("incompleteDirectory")}>Browse incomplete</button></div></label>
        <label className="filing-wide">Naming template<input value={options.namingTemplate} onChange={e => { invalidate(); setOptions(o => ({ ...o, namingTemplate: e.target.value })); }} /></label>
      </div>
      <p className="filing-help">Tokens: {"{albumartist}, {artist}, {year}, {album}, {disc}, {track}, {track:02}, {title}"}. The extension is kept. New downloads use the incomplete folder until you file them; existing downloads keep their paths.</p>
      <label className="filing-check"><input type="checkbox" checked={options.embedArtwork} onChange={e => { invalidate(); setOptions(o => ({ ...o, embedArtwork: e.target.checked })); }} />Embed the chosen edition’s Cover Art Archive front cover</label>
      <button type="button" onClick={() => void perform(async () => { await patchSettings({ filing: options }); setMessage("Filing defaults saved. Existing downloads keep their paths."); })}>Save filing defaults</button>
    </fieldset>
    {group && !history.some(r => r.plan.releaseId === group.releaseId && r.state !== "undone") && <fieldset disabled={busy}>
      <legend>Track identity</legend>
      <div className="filing-fields">
        <label>MusicBrainz release group ID<input value={groupId} onChange={e => { invalidate(); setGroupId(e.target.value); setEditions(null); setEditionId(""); setOfficial([]); }} /></label>
        <button type="button" disabled={!groupId} onClick={() => void perform(async () => { invalidate(); setEditions(await invoke<AlbumEditions>("album_editions", { releaseGroupId: groupId })); })}>Find editions</button>
        {editions && <><label>MusicBrainz edition<select value={editionId} onChange={e => { invalidate(); setEditionId(e.target.value); setOfficial([]); }}><option value="">Choose an edition</option>{editions.releases.map(e => <option key={e.id} value={e.id}>{e.date || "Unknown date"} · {e.country || "Worldwide"} · {e.title} · {e.trackCount ?? "?"} tracks {e.disambiguation}</option>)}</select></label>
          <button type="button" disabled={!editionId} onClick={() => void perform(async () => { invalidate(); setOfficial(await filingApi.metadata(groupId, editionId)); })}>Load edition tags</button>{editions.truncated && <p>MusicBrainz returned a limited edition list.</p>}</>}
      </div>
      <p className="filing-help">Assign each file to its track below, or enter tags manually. The filename-based starting values are suggestions. Review disc numbers for multi-disc albums.</p>
      <div className="filing-track-list">{tracks.map((row, index) => <details className="filing-track" key={row.transferId} open={tracks.length <= 3 || undefined}>
        <summary>{group.transfers.find(t => t.id === row.transferId)?.title} <span>→ {row.tags.disc}.{String(row.tags.track).padStart(2, "0")} {row.tags.title}</span></summary>
        {official.length > 0 && <label>Assign MusicBrainz track for file {index + 1}<select value={official.findIndex(t => t.releaseId === row.tags.releaseId && t.recordingId === row.tags.recordingId && t.disc === row.tags.disc && t.track === row.tags.track)} onChange={e => { const tags = official[Number(e.target.value)]; if (tags) editTrack(row.transferId, tags); }}><option value={-1}>Choose a track explicitly</option>{official.map((t,i) => <option key={`${t.disc}-${t.track}`} value={i}>{t.disc}.{String(t.track).padStart(2,"0")} · {t.artist} — {t.title}</option>)}</select></label>}
        <div className="filing-fields">{(["title", "artist", "albumArtist", "album", "date"] as const).map(key => <label key={key}>{({ title: "Title", artist: "Track artist", albumArtist: "Album artist", album: "Album", date: "Date" })[key]} — file {index + 1}<input value={row.tags[key]} onChange={e => editTrack(row.transferId, { [key]: e.target.value })} /></label>)}
          <label>Disc — file {index + 1}<input type="number" min={1} max={999} value={row.tags.disc} onChange={e => editTrack(row.transferId, { disc: Number(e.target.value) })} /></label>
          <label>Track — file {index + 1}<input type="number" min={1} max={999} value={row.tags.track} onChange={e => editTrack(row.transferId, { track: Number(e.target.value) })} /></label>
        </div>
        <details><summary>MusicBrainz IDs — file {index + 1}</summary><div className="filing-fields">{(["releaseGroupId", "releaseId", "recordingId"] as const).map(key => <label key={key}>{({ releaseGroupId: "Release group MBID", releaseId: "Release MBID", recordingId: "Recording MBID" })[key]} — file {index + 1}<input value={row.tags[key] ?? ""} onChange={e => editTrack(row.transferId, { [key]: e.target.value || null })} placeholder="Clear this ID" /></label>)}</div></details>
      </details>)}</div>
      <button type="button" className="is-primary" disabled={!tracks.length || !options.libraryRoot} onClick={() => void perform(async () => { setPlan(null); setReviewed(false); setPlan(await filingApi.preview({ releaseId: group.releaseId!, settings: options, tracks, artworkReleaseId: editionId || null })); })}>{busy ? "Working…" : "Preview tags and paths"}</button>
    </fieldset>}
    {plan && <section className="filing-preview" aria-label="Filing preview"><h4>Review before filing</h4><p>{plan.files.length} files · {plan.artworkBytes ? `${Math.ceil(plan.artworkBytes / 1024)} KB front cover will be embedded` : "Existing artwork will be kept"}</p>
      {plan.artworkPreview && <img className="filing-artwork" src={plan.artworkPreview} alt="Chosen edition front cover to embed" />}
      {plan.warnings.map(w => <p key={w} className="filing-help">{w}</p>)}<PlanFiles plan={plan} />
      <label className="filing-check"><input type="checkbox" disabled={busy} checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the track assignments, tags, and destination paths.</label>
      <button type="button" className="is-primary" disabled={!reviewed || busy} onClick={() => void perform(async () => { try { const result = await filingApi.apply(plan.id); setPlan(null); setMessage(`Filed into ${result.plan.albumDirectory}. Undo is available below.`); } finally { await refresh(); } })}>{busy ? "Filing…" : "Apply filing"}</button>
    </section>}
    <section className="filing-history" aria-label="Filing history"><h4>Filing history & undo</h4><p>Interrupted operations stay here. Undo restores original tags and paths only when the files still match. Later edits cause a conflict instead of being overwritten.</p>
      {!history.length && <p className="filing-help">No filing operations yet.</p>}
      {[...history].reverse().map(record => <article key={record.plan.id}><div><strong>{record.plan.title}</strong><span>{record.state === "filed" ? "Filed" : record.state === "undone" ? "Undone" : "Interrupted — review and undo"}</span></div><p className="filing-file-path">{record.plan.albumDirectory}</p>
        {record.state !== "undone" && <button type="button" disabled={busy} onClick={() => void perform(async () => { setUndo(await filingApi.undoPreview(record.plan.id)); })}>Preview undo</button>}
        {record.state === "filed" && <details><summary>Optional beets hand-off</summary><p>Run this command in PowerShell to open beets’ interactive import review. Beets must be installed. Changes made by beets are managed by beets and cannot be undone here.</p><code>{record.plan.beetsCommand}</code><button type="button" onClick={() => void perform(async () => { await navigator.clipboard.writeText(record.plan.beetsCommand); setMessage("Beets hand-off command copied."); })}>Copy beets command</button></details>}
      </article>)}
      {undo && <div className="filing-preview"><h4>Restore originals</h4><p>Remove the unchanged filed copies and restore these original files byte-for-byte:</p><ul>{undo.plan.files.map(f => <li className="filing-file-path" key={f.transferId}>{f.source}</li>)}</ul><button type="button" disabled={busy} onClick={() => void perform(async () => { await filingApi.undo(undo.plan.id); setUndo(null); setPlan(null); await refresh(); setMessage("Original files and transfer paths restored."); })}>Confirm undo filing</button><button type="button" disabled={busy} onClick={() => setUndo(null)}>Keep filed files</button></div>}
    </section>
  </section>;
}

function PlanFiles({ plan }: { plan: FilingPlan }) {
  return <div className="filing-plan-files">{plan.files.map(file => <details key={file.transferId}><summary>{file.tags?.title ?? "Companion file"}</summary><p className="filing-file-path">From: {file.source}<br />To: {file.destination}</p>{file.tags ? <div className="filing-tag-comparison"><div><h5>Current tags</h5><dl>{file.before.map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div><div><h5>Reviewed tags</h5><dl>{labelTags(file.tags).map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div></div> : <p>Copied unchanged.</p>}</details>)}</div>;
}
