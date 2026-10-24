import { ListeningPostWorkspace } from "../../components/ListeningPostWorkspace";
import { NewReleaseRadar } from "../../components/NewReleaseRadar";
import { useShell } from "../shellStore";

export default function HomeRoute() {
  const {
    connection,
    transfers,
    wanted,
    releaseRadar,
    messages,
    rooms,
    archive,
    archiveOwnedReleaseIds,
    missingStudioCount,
    missingShelf,
    openTransfer,
    openArchive,
    navigate,
    openRoom,
    dial,
    setSearchMode,
    setActiveView,
  } = useShell((s) => ({
    connection: s.connection,
    transfers: s.transfers,
    wanted: s.wanted,
    releaseRadar: s.releaseRadar,
    messages: s.messages,
    rooms: s.rooms,
    archive: s.archive,
    archiveOwnedReleaseIds: s.archiveOwnedReleaseIds,
    missingStudioCount: s.missingStudioCount,
    missingShelf: s.missingShelf,
    openTransfer: s.openTransfer,
    openArchive: s.openArchive,
    navigate: s.navigate,
    openRoom: s.openRoom,
    dial: s.dial,
    setSearchMode: s.setSearchMode,
    setActiveView: s.setActiveView,
  }));
  return (
    <ListeningPostWorkspace
      releaseRadar={<NewReleaseRadar radar={releaseRadar} sourceKey={`${archive.status?.path ?? ""}:${archive.status?.lastModifiedAtMs ?? ""}:${archive.status?.connected ?? false}`} archiveConnected={Boolean(archive.status?.connected)} wanted={wanted.snapshot.albums} wantedReady={wanted.ready} onAddWanted={wanted.add} onSearchArtists={() => {
        if (!dial.create({ mode: "albums" })) setSearchMode("albums");
        setActiveView("search");
      }} />}
      connection={connection.snapshot}
      searchNetwork={connection.searchNetwork}
      transfers={transfers.snapshot.transfers}
      wanted={wanted.snapshot}
      messages={messages.snapshot}
      rooms={rooms.snapshot}
      archiveStatus={archive.status}
      archiveOwnedReleaseIds={archiveOwnedReleaseIds}
      missingCount={missingStudioCount}
      missingShelfName={
        missingShelf.selectedArtist?.canonicalName ??
        missingShelf.selectedArtist?.name ??
        null
      }
      onOpenTransfer={openTransfer}
      onOpenArchive={openArchive}
      onOpenMessages={() => navigate("messages")}
      onOpenRoom={openRoom}
      onSearchAlbums={() => {
        if (!dial.create({ mode: "albums" })) setSearchMode("albums");
        setActiveView("search");
      }}
    />
  );
}
