import { BellRinging, Lightning } from "@phosphor-icons/react";
import { useState } from "react";
import { defaultSmartDownloads, patchSettings, savePreference, useSettings, type SmartDownloadSettings } from "../settings";
import type { WantedPreferences } from "../types";
import { wantedFormatOptions, wantedPreferencesLabel } from "../utils/smartMatches";

const stallOptions = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const attemptOptions = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20];
const albumOptions = [1, 2, 3, 4, 5, 6];
const secondsOptions = [0, 1, 2, 3, 5, 8, 10, 15, 20, 30];
const mismatchOptions = [0, 1, 2, 3, 5, 10];
const bitrateOptions: Array<WantedPreferences["minimumBitrateKbps"]> = [320, 256, 192, 128, null];

// Imported or older settings may hold a value the list does not offer.
const withCurrent = (options: number[], value: number) =>
  options.includes(value) ? options : [...options, value].sort((a, b) => a - b);

const minutesLabel = (minutes: number) =>
  minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}` : `${minutes} min`;

type Props = {
  /** Albums still being watched; the profile below can be copied onto them. */
  waitingAlbums?: number;
  onApplyProfile?: (preferences: WantedPreferences) => Promise<unknown>;
};

export function SmartDownloadsPanel({ waitingAlbums = 0, onApplyProfile }: Props) {
  const { settings } = useSettings();
  const smart = settings.wanted.smart ?? defaultSmartDownloads();
  const profile = settings.wanted.defaultPreferences;
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = (patch: Partial<SmartDownloadSettings>) => {
    setError(null);
    void patchSettings((current) => ({
      wantedSmartDownloads: { ...(current.wanted.smart ?? defaultSmartDownloads()), ...patch },
    })).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const changeProfile = (patch: Partial<WantedPreferences>) => {
    setError(null);
    setApplied(null);
    void patchSettings((current) => ({
      wantedDefaultPreferences: { ...current.wanted.defaultPreferences, ...patch },
    })).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const applyProfile = async () => {
    if (!onApplyProfile) return;
    setApplying(true);
    setError(null);
    try {
      await onApplyProfile(profile);
      setApplied(`Applied to ${waitingAlbums} ${waitingAlbums === 1 ? "album" : "albums"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="settings-panel smart-downloads-panel" aria-labelledby="smart-downloads-heading">
      <div className="settings-panel-heading">
        <div className="settings-icon"><Lightning size={19} weight="light" /></div>
        <div>
          <h2 id="smart-downloads-heading">Smart downloads</h2>
          <p>Add an album to Wanted and walk away. Forever finds the best source inside your accepted range, downloads it, verifies it, and switches to another source if one stalls.</p>
        </div>
      </div>

      <label className="toggle-row smart-downloads-master">
        <input type="checkbox" checked={smart.enabled} onChange={(event) => change({ enabled: event.target.checked })} aria-label="Download Wanted albums automatically" />
        <span className="toggle-visual" aria-hidden="true"><i /></span>
        <span>
          <strong>Download Wanted albums automatically</strong>
          <small>Off by default. Each album can still opt out from the Wanted list.</small>
        </span>
      </label>

      <fieldset className="smart-downloads-group">
        <legend>Accepted range</legend>
        <div className="smart-downloads-formats" role="radiogroup" aria-label="Preferred format">
          {wantedFormatOptions.map((option) => (
            <label key={option.value} className={profile.formatPreference === option.value ? "is-selected" : ""}>
              <input type="radio" name="smart-default-format" value={option.value} checked={profile.formatPreference === option.value} onChange={() => changeProfile({ formatPreference: option.value })} />
              <span><strong>{option.label}</strong><small>{option.copy}</small></span>
            </label>
          ))}
        </div>
        <div className="smart-downloads-fields">
          <label>
            <span><strong>Lossy fallback</strong><small>Applied only when a folder is not lossless.</small></span>
            <select aria-label="Lossy fallback bitrate" disabled={profile.formatPreference === "losslessOnly"} value={profile.minimumBitrateKbps ?? 0}
              onChange={(event) => changeProfile({ minimumBitrateKbps: Number(event.target.value) === 0 ? null : Number(event.target.value) as WantedPreferences["minimumBitrateKbps"] })}>
              {bitrateOptions.map((kbps) => <option key={kbps ?? 0} value={kbps ?? 0}>{kbps ? `${kbps} kbps minimum` : "Any bitrate"}</option>)}
            </select>
          </label>
        </div>
        <p className="smart-downloads-note">
          New Wanted albums start with <strong>{wantedPreferencesLabel(profile)}</strong>. Albums already on the list keep their own profile (edit it with the sliders button on the album).
        </p>
        {onApplyProfile && waitingAlbums > 0 ? (
          <div className="smart-downloads-apply">
            <button type="button" className="secondary-text-button" disabled={applying} onClick={() => void applyProfile()}>
              {applying ? "Applying…" : `Apply to the ${waitingAlbums} ${waitingAlbums === 1 ? "album" : "albums"} still wanted`}
            </button>
            {applied ? <span role="status">{applied}</span> : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="smart-downloads-group">
        <legend>Patience</legend>
        <div className="smart-downloads-fields">
          <label>
            <span><strong>Look for another source after</strong><small>No data received for this long, counted only while the source is the one holding things up.</small></span>
            <select aria-label="Stall timeout" value={smart.stallMinutes} onChange={(event) => change({ stallMinutes: Number(event.target.value) })}>
              {withCurrent(stallOptions, smart.stallMinutes).map((minutes) => <option key={minutes} value={minutes}>{minutesLabel(minutes)}</option>)}
            </select>
          </label>
          <label>
            <span><strong>Sources to try per album</strong><small>After this many, the album rests for six hours, then starts over.</small></span>
            <select aria-label="Sources to try per album" value={smart.maxAttempts} onChange={(event) => change({ maxAttempts: Number(event.target.value) })}>
              {withCurrent(attemptOptions, smart.maxAttempts).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label>
            <span><strong>Albums at the same time</strong><small>Smart downloads queue only this many albums at once.</small></span>
            <select aria-label="Albums downloading at once" value={smart.maxActiveAlbums} onChange={(event) => change({ maxActiveAlbums: Number(event.target.value) })}>
              {withCurrent(albumOptions, smart.maxActiveAlbums).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="smart-downloads-group">
        <legend>Track length tolerance</legend>
        <div className="smart-downloads-fields">
          <label>
            <span><strong>A track may differ by up to</strong><small>Compared with the length MusicBrainz lists. Remasters and fades often drift a few seconds.</small></span>
            <select aria-label="Track length tolerance in seconds" value={smart.durationToleranceSeconds} onChange={(event) => change({ durationToleranceSeconds: Number(event.target.value) })}>
              {withCurrent(secondsOptions, smart.durationToleranceSeconds).map((seconds) => <option key={seconds} value={seconds}>{seconds === 0 ? "Exactly the same second" : `${seconds} ${seconds === 1 ? "second" : "seconds"}`}</option>)}
            </select>
          </label>
          <label>
            <span><strong>Tracks allowed to differ more</strong><small>Forgives a few tracks, such as a longer live or hidden track.</small></span>
            <select aria-label="Tracks allowed to differ" value={smart.allowedLengthMismatches} onChange={(event) => change({ allowedLengthMismatches: Number(event.target.value) })}>
              {withCurrent(mismatchOptions, smart.allowedLengthMismatches).map((count) => <option key={count} value={count}>{count === 0 ? "None" : `Up to ${count}`}</option>)}
            </select>
          </label>
        </div>
        <p className="smart-downloads-note">Applies to Smart Matches, the review dialog, and automatic downloads. Changing it schedules a fresh check of every open Wanted album.</p>
      </fieldset>

      <label className="toggle-row smart-downloads-master">
        <input type="checkbox" checked={settings.preferences.downloadNotificationsEnabled ?? true} aria-label="Notify when a download is verified"
          onChange={(event) => savePreference({ downloadNotificationsEnabled: event.target.checked })} />
        <span className="toggle-visual" aria-hidden="true"><i /></span>
        <span>
          <strong><BellRinging size={13} /> Notify me when an album is verified</strong>
          <small>Shows a Windows notification when a download finishes and passes verification while Forever is hidden or in the background.</small>
        </span>
      </label>

      {error ? <p className="connection-error" role="alert">{error}</p> : null}
    </section>
  );
}
