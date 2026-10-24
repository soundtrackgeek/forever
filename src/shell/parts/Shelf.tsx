import { TransferShelf } from "../../components/TransferShelf";
import { useShell } from "../shellStore";

export default function Shelf() {
  const {
    transferShelfExpanded,
    transfers,
    navigate,
    openTransfer,
    people,
    openPerson,
    setTransferShelfExpanded,
  } = useShell((s) => ({
    transferShelfExpanded: s.transferShelfExpanded,
    transfers: s.transfers,
    navigate: s.navigate,
    openTransfer: s.openTransfer,
    people: s.people,
    openPerson: s.openPerson,
    setTransferShelfExpanded: s.setTransferShelfExpanded,
  }));
  return (
    <TransferShelf
      expanded={transferShelfExpanded}
      transfers={transfers.snapshot.transfers}
      activeCount={transfers.snapshot.activeCount}
      maxConcurrentDownloads={transfers.snapshot.maxConcurrentDownloads}
      error={transfers.error}
      onPause={(id) => void transfers.pause(id).catch(() => undefined)}
      onResume={(id) => void transfers.resume(id).catch(() => undefined)}
      onCancel={(id) => void transfers.cancel(id).catch(() => undefined)}
      onReveal={(id) => void transfers.reveal(id).catch(() => undefined)}
      onPauseRelease={(id) =>
        void transfers.pauseRelease(id).catch(() => undefined)
      }
      onResumeRelease={(id) =>
        void transfers.resumeRelease(id).catch(() => undefined)
      }
      onCancelRelease={(id) =>
        void transfers.cancelRelease(id).catch(() => undefined)
      }
      onRevealRelease={(id) =>
        void transfers.revealRelease(id).catch(() => undefined)
      }
      onViewAll={() => navigate("transfers")}
      onOpenTransfer={openTransfer}
      onDismissError={transfers.clearError}
      personByUsername={people.personByUsername}
      onOpenPerson={openPerson}
      onToggle={() => setTransferShelfExpanded((expanded) => !expanded)}
    />
  );
}
