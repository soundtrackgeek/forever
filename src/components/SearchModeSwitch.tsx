import { Disc, Files } from "@phosphor-icons/react";

export type SearchMode = "files" | "albums";

export function SearchModeSwitch({
  mode,
  onChange,
}: {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}) {
  return (
    <div className="search-mode-switch" role="tablist" aria-label="Search type">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "files"}
        className={mode === "files" ? "is-active" : ""}
        onClick={() => onChange("files")}
      >
        <Files size={13} /> Files
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "albums"}
        className={mode === "albums" ? "is-active" : ""}
        onClick={() => onChange("albums")}
      >
        <Disc size={13} /> Albums
      </button>
    </div>
  );
}
