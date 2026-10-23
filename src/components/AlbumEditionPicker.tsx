import { useEffect, useState } from "react";
import type { AlbumEdition, AlbumEditions } from "../types";

const editionLabel = (edition: AlbumEdition) => [
  edition.date || "Date unknown", edition.country || "Region unknown",
  edition.disambiguation || edition.title,
  edition.media.map((medium) => medium.format).filter(Boolean).join(" + "),
  edition.trackCount ? edition.trackCount + " tracks" : null,
  edition.id.slice(0, 8),
].filter(Boolean).join(" · ");

export function AlbumEditionPicker({ albumId, selectedReleaseId, disabled, onLoad, onSelect }: {
  albumId: string;
  selectedReleaseId?: string | null;
  disabled?: boolean;
  onLoad: (albumId: string) => Promise<AlbumEditions>;
  onSelect: (releaseId: string | null) => Promise<unknown>;
}) {
  const [loaded, setLoaded] = useState<{ albumId: string; data?: AlbumEditions; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = loaded?.albumId === albumId ? loaded : null;
  useEffect(() => {
    let active = true;
    void onLoad(albumId).then(
      (data) => { if (active) setLoaded({ albumId, data }); },
      (error: unknown) => { if (active) setLoaded({ albumId, error: String(error) }); },
    );
    return () => { active = false; };
  }, [albumId, onLoad, retry]);
  const select = async (value: string) => {
    setSaving(true);
    setSaveError(null);
    try { await onSelect(value || null); }
    catch (error) { setSaveError(String(error)); }
    finally { setSaving(false); }
  };
  return (
    <div className="album-edition-picker">
      <label>
        <span>MusicBrainz edition</span>
        <select aria-label="MusicBrainz edition" value={selectedReleaseId ?? ""}
          disabled={disabled || saving || !current?.data}
          onChange={(event) => void select(event.target.value)}>
          <option value="">Automatic · earliest official edition</option>
          {selectedReleaseId && !current?.data?.releases.some((r) => r.id === selectedReleaseId)
            ? <option value={selectedReleaseId}>Saved edition · {selectedReleaseId}</option> : null}
          {current?.data?.releases.map((edition) =>
            <option key={edition.id} value={edition.id}>{editionLabel(edition)}</option>)}
        </select>
      </label>
      <small>{saving ? "Loading and saving this edition…" : !current ? "Loading official editions…" :
        "Saved for this Wanted album. Length agreement allows ±3 seconds; unknown lengths use titles."}</small>
      {current?.data?.truncated ? <p>Showing the first 500 official editions; this list is incomplete.</p> : null}
      {current?.error ? <p role="alert">Editions unavailable. <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry editions</button></p> : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
    </div>
  );
}
