import { ArchiveWorkspace } from "../../components/ArchiveWorkspace";
import { MissingShelfWorkspace } from "../../components/MissingShelfWorkspace";
import { DiscoveryShelfWorkspace } from "../../components/DiscoveryShelfWorkspace";
import { useShell } from "../shellStore";

export default function ArchiveRoute() {
  const {
    archiveFocus,
    archive,
    wanted,
    missingShelf,
    discovery,
    connection,
    wantedDownloadStateByAlbumId,
    openTransfer,
    inspectSmartMatch,
    setPreferencesAlbum,
    openAlbumSources,
    openAlbumSourcesBatch,
    transferGroups,
    archiveOwnedReleaseIds,
    transfers,
    findRelaySources,
    search,
    loadOfficialTracklist,
    radar,
    musicBrainzFallbackTrackCount,
    officialTrackCountFor,
    queueAlbumSourceFor,
  } = useShell((s) => ({
    archiveFocus: s.archiveFocus,
    archive: s.archive,
    wanted: s.wanted,
    missingShelf: s.missingShelf,
    discovery: s.discovery,
    connection: s.connection,
    wantedDownloadStateByAlbumId: s.wantedDownloadStateByAlbumId,
    openTransfer: s.openTransfer,
    inspectSmartMatch: s.inspectSmartMatch,
    setPreferencesAlbum: s.setPreferencesAlbum,
    openAlbumSources: s.openAlbumSources,
    openAlbumSourcesBatch: s.openAlbumSourcesBatch,
    transferGroups: s.transferGroups,
    archiveOwnedReleaseIds: s.archiveOwnedReleaseIds,
    transfers: s.transfers,
    findRelaySources: s.findRelaySources,
    search: s.search,
    loadOfficialTracklist: s.loadOfficialTracklist,
    radar: s.radar,
    musicBrainzFallbackTrackCount: s.musicBrainzFallbackTrackCount,
    officialTrackCountFor: s.officialTrackCountFor,
    queueAlbumSourceFor: s.queueAlbumSourceFor,
  }));
  return (
    <ArchiveWorkspace
      key={archiveFocus?.requestId ?? "archive"}
      initialTab={archiveFocus?.tab ?? "library"}
      status={archive.status}
      loading={archive.loading}
      error={archive.error}
      wanted={wanted.snapshot}
      wantedReady={wanted.ready}
      wantedMatches={archive.wantedMatchByAlbumId}
      onSelectDatabase={async (path) => {
        missingShelf.resetSource();
        discovery.resetSource();
        try {
          return await archive.selectDatabase(path);
        } finally {
          missingShelf.resetSource();
          discovery.resetSource();
        }
      }}
      wantedError={wanted.error}
      online={connection.snapshot.state === "online"}
      onRefresh={async () => {
        missingShelf.clearCache();
        discovery.resetSource();
        return await archive.refresh();
      }}
      onSetWantedInterval={wanted.setIntervalMinutes}
      onCheckWanted={wanted.check}
      onSetWantedPaused={wanted.setPaused}
      onRemoveWanted={wanted.remove}
      onRestoreWanted={wanted.restore}
      downloadStateByAlbumId={wantedDownloadStateByAlbumId}
      onOpenTransfer={openTransfer}
      onReviewBest={(album) => void inspectSmartMatch(album)}
      onEditPreferences={setPreferencesAlbum}
      onOpenWanted={(album) =>
        openAlbumSources({
          albumId: album.albumId,
          artist: album.artist,
          title: album.title,
          coverArtUrl: album.coverArtUrl ?? "",
          firstReleaseDate: album.firstReleaseDate,
          minimumTrackCount: album.preferences.minimumTrackCount,
        })
      }
      onDismissWantedError={wanted.clearError}
      transferGroups={transferGroups}
      archiveOwnedReleaseIds={archiveOwnedReleaseIds}
      onRevealRelease={transfers.revealRelease}
      onVerifyRelease={transfers.verifyRelease}
      onSoundcheckRelease={transfers.soundcheckRelease}
      onFindAlternatives={findRelaySources}
      onPatchReleaseFile={transfers.patchReleaseFile}
      relayRecords={search.records}
      onLoadOfficialTracklist={loadOfficialTracklist}
      soundcheckEnabled={transfers.snapshot.soundcheckEnabled}
      onSetReleaseFiled={transfers.setReleaseFiled}
      onClearReleaseHistory={transfers.clearReleaseHistory}
      onOpenMissing={() => void missingShelf.activate().catch(() => undefined)}
      discoveryShelf={
        <DiscoveryShelfWorkspace
          discovery={discovery}
          connected={Boolean(archive.status?.connected)}
          online={connection.snapshot.state === "online"}
          wantedReady={wanted.ready}
          wantedAlbums={wanted.snapshot.albums}
          onAddWanted={wanted.add}
          onSearchAlbums={(artist, albums) => openAlbumSourcesBatch(albums.map((album) => ({ albumId: album.id, artist, title: album.title, coverArtUrl: album.coverArtUrl, firstReleaseDate: album.firstReleaseDate })))}
        />
      }
      missingShelf={
        <MissingShelfWorkspace
          query={missingShelf.query}
          artists={missingShelf.artists}
          artistsTruncated={missingShelf.artistsTruncated}
          selectedArtist={missingShelf.selectedArtist}
          identityOptions={missingShelf.identityOptions}
          catalog={missingShelf.catalog}
          catalogSource={missingShelf.catalogSource}
          catalogFetchedAt={missingShelf.catalogFetchedAt}
          loading={missingShelf.loading}
          error={missingShelf.error ?? radar.error ?? wanted.error}
          matchByAlbumId={missingShelf.matchByAlbumId}
          wantedAlbums={wanted.snapshot.albums}
          defaultPreferences={wanted.snapshot.defaultPreferences}
          musicBrainzFallbackTrackCount={musicBrainzFallbackTrackCount}
          online={connection.snapshot.state === "online"}
          radarReady={radar.ready}
          radarSnapshot={radar.snapshot}
          radarScans={radar.scansByAlbumId}
          radarResults={radar.resultsByAlbumId}
          transfers={transfers.snapshot.transfers}
          onSearchArtists={missingShelf.loadArtists}
          onSelectArtist={missingShelf.loadCatalog}
          onSelectIdentity={missingShelf.selectIdentity}
          onAddMany={wanted.addMany}
          onResolveOfficialTrackCount={officialTrackCountFor}
          onScan={radar.start}
          onStopScan={radar.stop}
          onQueueSource={(album, source, sources) =>
            queueAlbumSourceFor(
              {
                albumId: album.id,
                artist:
                  missingShelf.selectedArtist?.canonicalName ??
                  missingShelf.selectedArtist?.name ??
                  "Unknown artist",
                title: album.title,
                coverArtUrl: album.coverArtUrl,
                firstReleaseDate: album.firstReleaseDate,
              },
              source,
              sources,
            )
          }
          onOpenTransfer={openTransfer}
          onDismissError={() => {
            missingShelf.clearError();
            radar.clearError();
            wanted.clearError();
          }}
        />
      }
    />
  );
}
