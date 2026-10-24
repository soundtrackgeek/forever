import { BrowseSharesHome } from "../../components/BrowseSharesHome";
import { UserSharesWorkspace } from "../../components/UserSharesWorkspace";
import { useShell } from "../shellStore";

export default function BrowseRoute() {
  const {
    sharesUsername,
    shares,
    people,
    setSharesUsername,
    openPerson,
    transfers,
    openTransfer,
    connection,
    browseUser,
    setActiveView,
  } = useShell((s) => ({
    sharesUsername: s.sharesUsername,
    shares: s.shares,
    people: s.people,
    setSharesUsername: s.setSharesUsername,
    openPerson: s.openPerson,
    transfers: s.transfers,
    openTransfer: s.openTransfer,
    connection: s.connection,
    browseUser: s.browseUser,
    setActiveView: s.setActiveView,
  }));
  return sharesUsername ? (
    <UserSharesWorkspace
      key={sharesUsername}
      username={sharesUsername}
      overview={shares.overview}
      folder={shares.folder}
      results={shares.results}
      loading={shares.loading}
      error={shares.error}
      person={people.personByUsername(sharesUsername)}
      onBrowseAnother={() => {
        setSharesUsername(null);
        shares.clear();
      }}
      onOpenPerson={() => openPerson(sharesUsername)}
      onRefresh={() =>
        void shares.browse(sharesUsername, true).catch(() => undefined)
      }
      onOpenFolder={(directory) =>
        void shares.openFolder(sharesUsername, directory).catch(() => undefined)
      }
      onSearch={(shareQuery, extension) =>
        void shares
          .search(sharesUsername, shareQuery, extension)
          .catch(() => undefined)
      }
      transfers={transfers.snapshot.transfers}
      onDownload={(title, remoteFolder, files) => {
        return transfers
          .enqueueRelease({
            title,
            username: sharesUsername,
            remoteFolder,
            files,
          })
          .then(() => undefined);
      }}
      onOpenTransfer={openTransfer}
    />
  ) : (
    <BrowseSharesHome
      people={people.snapshot}
      connection={connection.snapshot}
      onBrowse={browseUser}
      onOpenConnection={() => setActiveView("settings")}
    />
  );
}
