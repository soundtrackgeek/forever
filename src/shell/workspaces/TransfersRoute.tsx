import { TransfersWorkspace } from "../../components/TransfersWorkspace";
import { useShell } from "../shellStore";

export default function TransfersRoute() {
  const {
    transferFocus,
    transfers,
    search,
    connection,
    archiveOwnedReleaseIds,
    sharing,
    findRelaySources,
    relayReleaseSource,
    people,
    openPerson,
  } = useShell((s) => ({
    transferFocus: s.transferFocus,
    transfers: s.transfers,
    search: s.search,
    connection: s.connection,
    archiveOwnedReleaseIds: s.archiveOwnedReleaseIds,
    sharing: s.sharing,
    findRelaySources: s.findRelaySources,
    relayReleaseSource: s.relayReleaseSource,
    people: s.people,
    openPerson: s.openPerson,
  }));
  return (
    <TransfersWorkspace
      key={transferFocus?.requestId ?? "transfers"}
      transfers={transfers.snapshot.transfers}
      sourceReliability={transfers.snapshot.sourceReliability}
      safetyState={transfers.snapshot.safetyState}
      maxConcurrentDownloads={transfers.snapshot.maxConcurrentDownloads}
      relaySuggestionMinutes={transfers.snapshot.relaySuggestionMinutes}
      relayRecords={search.records}
      online={connection.snapshot.state === "online"}
      archiveOwnedReleaseIds={archiveOwnedReleaseIds}
      uploads={sharing.uploads.uploads}
      uploadError={sharing.error}
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
      onReorderRelease={(id, beforeTransferId) =>
        void transfers
          .reorderRelease(id, beforeTransferId)
          .catch(() => undefined)
      }
      onClearCompleted={() =>
        void transfers.clearCompleted().catch(() => undefined)
      }
      onVerifyRelease={(id) =>
        void transfers.verifyRelease(id).catch(() => undefined)
      }
      onRetryReleaseIssues={(id) =>
        void transfers.retryReleaseIssues(id).catch(() => undefined)
      }
      onSwitchReleaseSource={(id, source) =>
        void transfers.switchReleaseSource(id, source).catch(() => undefined)
      }
      onFindAlternatives={(id, title) =>
        void findRelaySources(id, title).catch(() => undefined)
      }
      onRelayReleaseSource={relayReleaseSource}
      onDismissError={transfers.clearError}
      personByUsername={people.personByUsername}
      onOpenPerson={openPerson}
      onCancelUpload={(id) =>
        void sharing.cancelUpload(id).catch(() => undefined)
      }
      onClearFinishedUploads={() =>
        void sharing.clearFinishedUploads().catch(() => undefined)
      }
      onDismissUploadError={sharing.clearError}
      focusTarget={transferFocus}
    />
  );
}
