import { Check, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { WantedAlbum, WantedFormatPreference, WantedPreferences } from "../types";
import { wantedPreferencesLabel } from "../utils/smartMatches";

type SmartMatchPreferencesDialogProps = {
  album: WantedAlbum;
  onSave: (preferences: WantedPreferences) => Promise<unknown>;
  onClose: () => void;
};

const formatOptions: Array<{
  value: WantedFormatPreference;
  label: string;
  copy: string;
}> = [
  { value: "preferLossless", label: "Prefer FLAC", copy: "Recommend lossless first, with a high-quality lossy fallback." },
  { value: "losslessOnly", label: "Lossless only", copy: "Ignore MP3, AAC, OGG, and other lossy folders." },
  { value: "any", label: "Any format", copy: "Rank every source by completeness and availability." },
];

export function SmartMatchPreferencesDialog({
  album,
  onSave,
  onClose,
}: SmartMatchPreferencesDialogProps) {
  const [preferences, setPreferences] = useState(album.preferences);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await onSave(preferences);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="smart-match-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="smart-preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="smart-preferences-title">
        <header>
          <span className="smart-dialog-mark"><SlidersHorizontal size={22} weight="light" /></span>
          <span>
            <small>Smart Match profile</small>
            <h2 id="smart-preferences-title">Choose the signal worth hearing.</h2>
            <p>{album.artist} · {album.title}</p>
          </span>
          <button type="button" aria-label="Close Smart Match preferences" onClick={onClose}><X size={17} /></button>
        </header>

        <fieldset className="smart-format-options">
          <legend>Format priority</legend>
          {formatOptions.map((option) => (
            <label className={preferences.formatPreference === option.value ? "is-selected" : ""} key={option.value}>
              <input
                type="radio"
                name="smart-format"
                value={option.value}
                checked={preferences.formatPreference === option.value}
                onChange={() => setPreferences((current) => ({ ...current, formatPreference: option.value }))}
              />
              <span><strong>{option.label}</strong><small>{option.copy}</small></span>
              <i>{preferences.formatPreference === option.value ? <Check size={13} weight="bold" /> : null}</i>
            </label>
          ))}
        </fieldset>

        <div className="smart-preference-fields">
          <label>
            <span>Lossy fallback</span>
            <select
              disabled={preferences.formatPreference === "losslessOnly"}
              value={preferences.minimumBitrateKbps ?? 0}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                minimumBitrateKbps: Number(event.target.value) === 0
                  ? null
                  : Number(event.target.value) as 128 | 192 | 256 | 320,
              }))}
            >
              <option value={320}>320 kbps minimum</option>
              <option value={256}>256 kbps minimum</option>
              <option value={192}>192 kbps minimum</option>
              <option value={128}>128 kbps minimum</option>
              <option value={0}>Any bitrate</option>
            </select>
            <small>Applied only when the folder is not lossless.</small>
          </label>
          <label>
            <span>Minimum track count</span>
            <input
              type="number"
              min={1}
              max={250}
              placeholder="Best available"
              value={preferences.minimumTrackCount ?? ""}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                minimumTrackCount: event.target.value ? Number(event.target.value) : null,
              }))}
            />
            <small>Leave empty when editions may have different track counts.</small>
          </label>
        </div>

        <div className="smart-preference-summary">
          <small>Forever will recommend</small>
          <strong>{wantedPreferencesLabel(preferences)}</strong>
          <p>Changing this profile schedules a fresh background check. Downloads still require your approval.</p>
        </div>

        {error ? <p className="smart-dialog-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="secondary-text-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-action" disabled={pending} onClick={() => void save()}>
            {pending ? "Saving…" : "Save match profile"}
          </button>
        </footer>
      </section>
    </div>
  );
}
