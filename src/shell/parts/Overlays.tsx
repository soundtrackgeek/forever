import {
  CheckCircle,
  DownloadSimple,
  Radio,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { ConnectionOnboarding } from "../../components/ConnectionOnboarding";
import { SafeExitDialog } from "../../components/SafeExitDialog";
import { SmartMatchPreferencesDialog } from "../../components/SmartMatchPreferencesDialog";
import { SmartMatchReviewDialog } from "../../components/SmartMatchReviewDialog";
import { UpdateExperience } from "../../components/UpdateExperience";
import { WantedAlert } from "../../components/WantedAlert";
import { useShell } from "../shellStore";
export default function Overlays() {
  const {
    transfers,
    openTransfer,
    relayNotice,
    setRelayNotice,
    updater,
    safeExitOpen,
    safeExitPreview,
    safeExitPreparing,
    setSafeExitOpen,
    pauseSafelyAndExit,
    preferencesAlbum,
    wanted,
    loadEditions,
    setPreferencesAlbum,
    reviewAlbum,
    reviewInspection,
    reviewOfficialTracks,
    reviewTracklistState,
    reviewLoading,
    reviewError,
    wantedDownloadStateByAlbumId,
    queueReviewedSmartMatch,
    selectReviewEdition,
    inspectSmartMatch,
    closeReview,
    openAlbumSources,
    onboardingOpen,
    connection,
    setOnboardingInProgress,
    setOnboardingDismissed,
  } = useShell((s) => ({
    transfers: s.transfers,
    openTransfer: s.openTransfer,
    relayNotice: s.relayNotice,
    setRelayNotice: s.setRelayNotice,
    updater: s.updater,
    safeExitOpen: s.safeExitOpen,
    safeExitPreview: s.safeExitPreview,
    safeExitPreparing: s.safeExitPreparing,
    setSafeExitOpen: s.setSafeExitOpen,
    pauseSafelyAndExit: s.pauseSafelyAndExit,
    preferencesAlbum: s.preferencesAlbum,
    wanted: s.wanted,
    loadEditions: s.loadEditions,
    setPreferencesAlbum: s.setPreferencesAlbum,
    reviewAlbum: s.reviewAlbum,
    reviewInspection: s.reviewInspection,
    reviewOfficialTracks: s.reviewOfficialTracks,
    reviewTracklistState: s.reviewTracklistState,
    reviewLoading: s.reviewLoading,
    reviewError: s.reviewError,
    wantedDownloadStateByAlbumId: s.wantedDownloadStateByAlbumId,
    queueReviewedSmartMatch: s.queueReviewedSmartMatch,
    selectReviewEdition: s.selectReviewEdition,
    inspectSmartMatch: s.inspectSmartMatch,
    closeReview: s.closeReview,
    openAlbumSources: s.openAlbumSources,
    onboardingOpen: s.onboardingOpen,
    connection: s.connection,
    setOnboardingInProgress: s.setOnboardingInProgress,
    setOnboardingDismissed: s.setOnboardingDismissed,
  }));
  return (
    <>
      {transfers.completionNotice ? (
        <aside
          className={`finish-line-toast is-${transfers.completionNotice.kind}`}
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            className="finish-line-toast-open"
            onClick={() => openTransfer(transfers.completionNotice!.groupId)}
          >
            <span>
              {transfers.completionNotice.kind === "verified" ? (
                <CheckCircle size={19} weight="fill" />
              ) : (
                <WarningCircle size={19} weight="fill" />
              )}
            </span>
            <span>
              <small>
                {transfers.completionNotice.kind === "verified"
                  ? "Download verified"
                  : "Completed with issues"}
              </small>
              <strong>{transfers.completionNotice.title}</strong>
              <p>{transfers.completionNotice.message}</p>
            </span>
          </button>
          <button
            type="button"
            className="finish-line-toast-dismiss"
            aria-label="Dismiss download notification"
            onClick={transfers.clearCompletionNotice}
          >
            <X size={14} />
          </button>
        </aside>
      ) : null}

      {transfers.activityNotice ? (
        <aside
          className={`finish-line-toast transfer-activity-toast is-${transfers.activityNotice.kind}`}
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            className="finish-line-toast-open"
            onClick={() => openTransfer(transfers.activityNotice!.groupId)}
          >
            <span>
              {transfers.activityNotice.kind === "failed" ? (
                <WarningCircle size={19} weight="fill" />
              ) : transfers.activityNotice.kind === "started" ? (
                <Radio size={19} weight="fill" />
              ) : (
                <DownloadSimple size={19} weight="bold" />
              )}
            </span>
            <span>
              <small>
                {transfers.activityNotice.kind === "failed"
                  ? "Signal needs attention"
                  : transfers.activityNotice.kind === "started"
                    ? "Download started"
                    : "Release queued"}
              </small>
              <strong>{transfers.activityNotice.title}</strong>
              <p>{transfers.activityNotice.message}</p>
            </span>
          </button>
          <button
            type="button"
            className="finish-line-toast-dismiss"
            aria-label="Dismiss transfer update"
            onClick={transfers.clearActivityNotice}
          >
            <X size={14} />
          </button>
        </aside>
      ) : null}

      {relayNotice ? (
        <aside
          className="finish-line-toast transfer-activity-toast is-relay"
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            className="finish-line-toast-open"
            onClick={() => {
              openTransfer(relayNotice.groupId);
              setRelayNotice(null);
            }}
          >
            <span>
              <Radio size={19} weight="fill" />
            </span>
            <span>
              <small>Signal Relay found a route</small>
              <strong>{relayNotice.title}</strong>
              <p>
                {relayNotice.count} compatible{" "}
                {relayNotice.count === 1 ? "source is" : "sources are"} ready to
                compare.
              </p>
            </span>
          </button>
          <button
            type="button"
            className="finish-line-toast-dismiss"
            aria-label="Dismiss Signal Relay notification"
            onClick={() => setRelayNotice(null)}
          >
            <X size={14} />
          </button>
        </aside>
      ) : null}

      <UpdateExperience
        {...updater}
        transfers={transfers.snapshot}
        onPrepareTransfers={transfers.prepareForRestart}
        onCancelPreparation={transfers.cancelRestartPreparation}
      />

      <SafeExitDialog
        open={safeExitOpen}
        activeCount={
          safeExitPreview
            ? Math.max(1, transfers.snapshot.activeCount)
            : transfers.snapshot.activeCount
        }
        preparing={safeExitPreparing}
        error={transfers.error}
        onKeepRunning={() => setSafeExitOpen(false)}
        onPauseAndExit={() => void pauseSafelyAndExit()}
      />

      {preferencesAlbum ? (
        <SmartMatchPreferencesDialog
          key={preferencesAlbum.albumId}
          album={
            wanted.byAlbumId.get(preferencesAlbum.albumId) ?? preferencesAlbum
          }
          onLoadEditions={loadEditions}
          onSelectEdition={(releaseId) =>
            wanted.setEdition(preferencesAlbum.albumId, releaseId)
          }
          defaultPreferences={wanted.snapshot.defaultPreferences}
          onSave={async (preferences, saveAsDefault) => {
            await wanted.setPreferences(preferencesAlbum.albumId, preferences);
            if (saveAsDefault) await wanted.setDefaultPreferences(preferences);
          }}
          onClose={() => setPreferencesAlbum(null)}
        />
      ) : null}

      {reviewAlbum ? (
        <SmartMatchReviewDialog
          album={reviewAlbum}
          inspection={reviewInspection}
          officialTracks={reviewOfficialTracks}
          tracklistState={reviewTracklistState}
          loading={reviewLoading}
          error={reviewError}
          queued={wantedDownloadStateByAlbumId.has(reviewAlbum.albumId)}
          onConfirm={queueReviewedSmartMatch}
          onLoadEditions={loadEditions}
          onSelectEdition={selectReviewEdition}
          onRetry={() => void inspectSmartMatch(reviewAlbum)}
          onCompare={() => {
            closeReview();
            openAlbumSources({
              albumId: reviewAlbum.albumId,
              artist: reviewAlbum.artist,
              title: reviewAlbum.title,
              coverArtUrl: reviewAlbum.coverArtUrl ?? "",
              firstReleaseDate: reviewAlbum.firstReleaseDate,
              minimumTrackCount: reviewAlbum.preferences.minimumTrackCount,
            });
          }}
          onClose={closeReview}
        />
      ) : null}

      {wanted.alert ? (
        <WantedAlert
          album={wanted.alert}
          onReview={() => {
            const album = wanted.alert;
            if (!album) return;
            wanted.dismissAlert();
            void inspectSmartMatch(album);
          }}
          onCompare={() => {
            const album = wanted.alert;
            if (!album) return;
            wanted.dismissAlert();
            openAlbumSources({
              albumId: album.albumId,
              artist: album.artist,
              title: album.title,
              coverArtUrl: album.coverArtUrl ?? "",
              firstReleaseDate: album.firstReleaseDate,
              minimumTrackCount: album.preferences.minimumTrackCount,
            });
          }}
          onDismiss={wanted.dismissAlert}
        />
      ) : null}

      {onboardingOpen && connection.ready && (
        <ConnectionOnboarding
          profile={connection.profile ?? connection.suggestedProfile}
          hasPassword={connection.hasPassword}
          snapshot={connection.snapshot}
          error={connection.error}
          onSave={(profile, password) => {
            setOnboardingInProgress(true);
            return connection.saveProfile(profile, password);
          }}
          onConnect={connection.connect}
          onComplete={() => {
            setOnboardingInProgress(false);
            setOnboardingDismissed(true);
          }}
          onExploreOffline={() => {
            setOnboardingInProgress(false);
            setOnboardingDismissed(true);
          }}
        />
      )}
    </>
  );
}
