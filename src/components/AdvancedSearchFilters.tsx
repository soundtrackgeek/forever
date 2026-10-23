import { defaultAdvancedFilters, type AdvancedSearchFilters as Filters } from "../utils/searchResults";

export function AdvancedSearchFilters({ value, onChange, albumSources }: {
  value: Filters; onChange: (value: Filters) => void; albumSources: boolean;
}) {
  const numeric = (key: keyof Filters, label: string, step = 1) => (
    <label key={key}>{label}<input type="number" min={key === "resultsPerUser" ? 1 : 0} step={step}
      value={value[key] as number ?? ""} placeholder="Any"
      onChange={(event) => onChange({ ...value, [key]: event.target.value === "" ? null : Math.max(key === "resultsPerUser" ? 1 : 0, event.target.valueAsNumber || 0) })} /></label>
  );
  return <details className="advanced-search-filters" onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary>Advanced filters <span>{Object.entries(value).filter(([key, item]) => item !== defaultAdvancedFilters[key as keyof Filters]).length || ""}</span></summary>
    <div className="advanced-filter-panel">
      <div className="advanced-filter-fields">
        {numeric("minimumBitrate", "Minimum bitrate (kbps)")}
        {numeric("minimumSampleRate", "Minimum sample rate (Hz)")}
        {numeric("minimumBitDepth", "Minimum bit depth")}
        {numeric("maximumQueue", "Maximum queue length")}
        {numeric("minimumSizeMb", "Minimum size (MB)", 0.1)}
        {numeric("maximumSizeMb", "Maximum size (MB)", 0.1)}
        {numeric("resultsPerUser", albumSources ? "Sources per user" : "Results per user")}
        <label>Extensions<input value={value.extensions} placeholder="flac, mp3" maxLength={500} onChange={(event) => onChange({ ...value, extensions: event.target.value })} /></label>
        <label>Excluded words<input value={value.excludedWords} placeholder="live, remaster" maxLength={500} onChange={(event) => onChange({ ...value, excludedWords: event.target.value })} /></label>
        <label>Countries<input value={value.countries} placeholder="NO, GB, unknown" maxLength={500} onChange={(event) => onChange({ ...value, countries: event.target.value })} /></label>
      </div>
      <div className="advanced-filter-toggles">
        <label><input type="checkbox" checked={value.freeSlotOnly} onChange={(event) => onChange({ ...value, freeSlotOnly: event.target.checked })} />Free slot only</label>
        <label><input type="checkbox" checked={value.hideBlockedIgnored} onChange={(event) => onChange({ ...value, hideBlockedIgnored: event.target.checked })} />Hide blocked or ignored users</label>
        <button type="button" onClick={() => onChange({ ...value, minimumSampleRate: 96000, minimumBitDepth: 24 })}>24-bit / 96 kHz</button>
        <button type="button" onClick={() => onChange({ ...defaultAdvancedFilters })}>Reset advanced filters</button>
      </div>
      <p>Lists accept commas or spaces. Exclusions match any part of a file path. Countries use two-letter codes or “unknown”. Unknown values fail active numeric filters.
        {albumSources ? " Quality and extension filters apply to every audio track; size is the whole source total. Companion files stay included. The cap counts whole sources after sorting." : " Size is per file. The per-user cap applies after sorting."}</p>
      {value.minimumSizeMb !== null && value.maximumSizeMb !== null && value.minimumSizeMb > value.maximumSizeMb ? <p role="alert">Minimum size exceeds maximum size. No results can match this range.</p> : null}
    </div>
  </details>;
}
