import type { SearchSort } from "../utils/searchResults";

export function SearchSortHeader({ label, ascending, descending, sort, onChange }: {
  label: string; ascending: SearchSort; descending: SearchSort; sort: SearchSort; onChange: (sort: SearchSort) => void;
}) {
  const direction = sort === ascending ? "ascending" : sort === descending ? "descending" : "none";
  return <span role="columnheader" aria-sort={direction}>
    <button type="button" onClick={() => onChange(sort === ascending ? descending : ascending)}>
      {label}{direction === "ascending" ? " ↑" : direction === "descending" ? " ↓" : ""}
    </button>
  </span>;
}
