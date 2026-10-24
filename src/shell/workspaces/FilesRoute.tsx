import { ReleaseInspector } from "../../components/ReleaseInspector";
import { SearchWorkspace } from "../../components/SearchWorkspace";
import { PresetRail } from "../PresetRail";
import { useShell } from "../shellStore";

export default function FilesRoute() {
  const {
    searchMode,
    albumContext,
    albumResultView,
    archive,
    wanted,
    query,
    transfers,
    selectedResult,
    connection,
    setActiveView,
    setQuery,
    setSelectedResultId,
    setAlbumContext,
    setAlbumResultView,
    queueDownload,
    queueAlbumSource,
    openTransfer,
    browseUser,
    people,
    openPerson,
    changeSearchMode,
    loadOfficialTracklist,
    isFileSearchView,
    navigate,
    dial,
    search,
    folders,
  } = useShell((s) => ({
    searchMode: s.searchMode,
    albumContext: s.albumContext,
    albumResultView: s.albumResultView,
    archive: s.archive,
    wanted: s.wanted,
    query: s.query,
    transfers: s.transfers,
    selectedResult: s.selectedResult,
    connection: s.connection,
    setActiveView: s.setActiveView,
    setQuery: s.setQuery,
    setSelectedResultId: s.setSelectedResultId,
    setAlbumContext: s.setAlbumContext,
    setAlbumResultView: s.setAlbumResultView,
    queueDownload: s.queueDownload,
    queueAlbumSource: s.queueAlbumSource,
    openTransfer: s.openTransfer,
    browseUser: s.browseUser,
    people: s.people,
    openPerson: s.openPerson,
    changeSearchMode: s.changeSearchMode,
    loadOfficialTracklist: s.loadOfficialTracklist,
    isFileSearchView: s.isFileSearchView,
    navigate: s.navigate,
    dial: s.dial,
    search: s.search,
    folders: s.folders,
  }));
  return (
    <>
      <SearchWorkspace
        presetRail={<PresetRail />}
        sessionId={dial.activeId}
        scrollMemory={dial.resultScrollMemory}
        filter={dial.active.searchFilter}
        sort={dial.active.searchSort}
        advancedFilters={dial.active.advancedFilters}
        onAdvancedFiltersChange={(advancedFilters) =>
          dial.update(dial.activeId, { advancedFilters })
        }
        layout={dial.active.searchLayout}
        searchMode={searchMode}
        albumContext={albumContext}
        albumResultView={albumResultView}
        archiveConnected={Boolean(archive.status?.connected)}
        archiveLoading={archive.loading || archive.matching}
        archiveMatch={
          albumContext
            ? archive.matchByAlbumId.get(albumContext.albumId)
            : undefined
        }
        wantedAlbum={
          albumContext
            ? (wanted.byAlbumId.get(albumContext.albumId) ?? null)
            : null
        }
        query={query}
        results={search.results}
        transfers={transfers.snapshot.transfers}
        selectedResult={selectedResult}
        search={search.snapshot}
        searchError={search.error}
        connection={connection.snapshot}
        onOpenConnection={() => setActiveView("settings")}
        onFilterChange={(searchFilter) =>
          dial.update(dial.activeId, { searchFilter })
        }
        onSortChange={(searchSort) =>
          dial.update(dial.activeId, { searchSort })
        }
        onLayoutChange={(searchLayout) =>
          dial.update(dial.activeId, { searchLayout })
        }
        onQueryChange={setQuery}
        onSearch={(nextQuery) => {
          const normalizedQuery = nextQuery.trim();
          setQuery(normalizedQuery);
          setSelectedResultId(null);
          setAlbumContext(null);
          setAlbumResultView("files");
          void search
            .startSearch(dial.activeId, normalizedQuery)
            .catch(() => undefined);
        }}
        onStopSearch={() => void search.stopSearch(dial.activeId)}
        onSelectResult={(result) => {
          setSelectedResultId(result.id);
          folders.clear();
        }}
        onQueueDownload={queueDownload}
        onQueueAlbumSource={queueAlbumSource}
        onOpenTransfer={openTransfer}
        onBrowseUser={browseUser}
        personByUsername={people.personByUsername}
        onOpenPerson={openPerson}
        onSearchModeChange={changeSearchMode}
        onAlbumResultViewChange={setAlbumResultView}
        onLoadOfficialTracklist={loadOfficialTracklist}
        onToggleWanted={() => {
          if (!albumContext) return Promise.resolve();
          if (wanted.byAlbumId.has(albumContext.albumId)) {
            return wanted.remove(albumContext.albumId);
          }
          return wanted.add(albumContext.artist, {
            id: albumContext.albumId,
            title: albumContext.title,
            firstReleaseDate: albumContext.firstReleaseDate,
            primaryType: "Album",
            secondaryTypes: [],
            coverArtUrl: albumContext.coverArtUrl,
          });
        }}
      />
      {isFileSearchView ? (
        <ReleaseInspector
          result={selectedResult}
          inspection={folders.inspection}
          folderLoading={folders.loading}
          folderError={folders.error}
          onInspectFolder={(result) => {
            void folders.inspect(result).catch(() => undefined);
          }}
          onQueueDownload={queueDownload}
          onBrowseUser={browseUser}
          person={
            selectedResult
              ? people.personByUsername(selectedResult.owner)
              : null
          }
          onOpenPerson={openPerson}
          onQueueRelease={(result, title, inspection, files) => {
            void transfers
              .enqueueRelease({
                title,
                username: result.owner,
                remoteFolder: inspection.requestedFolder,
                files,
              })
              .then(() => navigate("transfers"))
              .catch(() => undefined);
          }}
        />
      ) : null}
    </>
  );
}
