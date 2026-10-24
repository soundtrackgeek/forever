import { AlbumSearchWorkspace } from "../../components/AlbumSearchWorkspace";
import { PresetRail } from "../PresetRail";
import { useShell } from "../shellStore";

export default function AlbumsRoute() {
  const {
    query,
    connection,
    searchMode,
    archive,
    wanted,
    setQuery,
    changeSearchMode,
    openAlbumSources,
    setActiveView,
    dial,
    albums,
  } = useShell((s) => ({
    query: s.query,
    connection: s.connection,
    searchMode: s.searchMode,
    archive: s.archive,
    wanted: s.wanted,
    setQuery: s.setQuery,
    changeSearchMode: s.changeSearchMode,
    openAlbumSources: s.openAlbumSources,
    setActiveView: s.setActiveView,
    dial: s.dial,
    albums: s.albums,
  }));
  return (
    <AlbumSearchWorkspace
      presetRail={<PresetRail />}
      filter={dial.active.albumFilter}
      query={query}
      artists={albums.artists}
      selectedArtist={albums.selectedArtist}
      catalog={albums.catalog}
      loading={albums.loading}
      error={albums.error}
      connection={connection.snapshot}
      searchMode={searchMode}
      archiveConnected={Boolean(archive.status?.connected)}
      archiveLoading={archive.loading || archive.matching}
      archiveMatches={archive.matchByAlbumId}
      wantedAlbums={wanted.byAlbumId}
      onQueryChange={setQuery}
      onFilterChange={(albumFilter) =>
        dial.update(dial.activeId, { albumFilter })
      }
      onSearch={(artistQuery) => {
        void albums.searchArtists(artistQuery).catch(() => undefined);
      }}
      onSelectArtist={(artist) => {
        void albums.selectArtist(artist).catch(() => undefined);
      }}
      onSearchModeChange={changeSearchMode}
      onAddWanted={wanted.add}
      onRemoveWanted={wanted.remove}
      onSearchSoulseek={(artist, album) => {
        openAlbumSources({
          albumId: album.id,
          artist,
          title: album.title,
          coverArtUrl: album.coverArtUrl,
          firstReleaseDate: album.firstReleaseDate,
        });
      }}
      onOpenConnection={() => setActiveView("settings")}
      onDismissError={albums.clearError}
    />
  );
}
