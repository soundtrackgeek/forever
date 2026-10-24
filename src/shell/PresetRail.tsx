import { SearchPresetRail } from "../components/SearchPresetRail";
import { useShell } from "./shellStore";

export function PresetRail() {
  const { dial, search, albums, folders } = useShell((s) => ({
    dial: s.dial,
    search: s.search,
    albums: s.albums,
    folders: s.folders,
  }));
  return (
    <SearchPresetRail
      sessions={dial.sessions}
      activeId={dial.activeId}
      records={search.records}
      albumStates={albums.states}
      recent={dial.recent}
      atLimit={dial.atLimit}
      onSelect={(id) => {
        dial.select(id);
        search.markSeen(id);
        folders.clear();
      }}
      onCreate={() => {
        dial.create({ mode: "files" });
      }}
      onClose={(id) => {
        dial.close(id);
        void search.closeSearch(id);
      }}
      onTogglePin={(id, pinned) => dial.update(id, { pinned })}
      onDuplicate={(id) => {
        dial.duplicate(id);
      }}
      onStopAll={() => {
        void search.stopAllSearches();
      }}
      onReopen={(item) => {
        dial.reopen(item);
      }}
    />
  );
}
