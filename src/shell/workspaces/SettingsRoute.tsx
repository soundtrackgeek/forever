import { ConnectionSettings } from "../../components/ConnectionSettings";
import { savePreference } from "../../settings";
import { normalizeMusicBrainzFallbackTrackCount } from "../../utils/musicbrainzFallback";
import { useShell } from "../shellStore";

export default function SettingsRoute() {
  const {
    native,
    connection,
    archive,
    setOnboardingDismissed,
    updater,
    musicBrainzFallbackTrackCount,
    sharing,
    transfers,
    messages,
    rooms,
  } = useShell((s) => ({
    native: s.native,
    connection: s.connection,
    archive: s.archive,
    setOnboardingDismissed: s.setOnboardingDismissed,
    updater: s.updater,
    musicBrainzFallbackTrackCount: s.musicBrainzFallbackTrackCount,
    sharing: s.sharing,
    transfers: s.transfers,
    messages: s.messages,
    rooms: s.rooms,
  }));
  return (
    <ConnectionSettings
      onSettingsApplied={() => {
        if (native) {
          void connection.refresh();
          void archive.refresh().catch(() => {});
        }
      }}
      profile={connection.profile ?? connection.suggestedProfile}
      hasPassword={connection.hasPassword}
      snapshot={connection.snapshot}
      searchNetwork={connection.searchNetwork}
      reachability={connection.reachability}
      onTestReachability={connection.testReachability}
      diagnostics={connection.diagnostics}
      diagnosticsPath={connection.diagnosticsPath}
      error={connection.error}
      onSave={connection.saveProfile}
      onConnect={connection.connect}
      onDisconnect={connection.disconnect}
      onReset={async () => {
        await connection.reset();
        setOnboardingDismissed(false);
      }}
      onLoadDiagnostics={connection.loadDiagnostics}
      onCheckForUpdates={() => void updater.checkForUpdates(true)}
      updateCheckIntervalMinutes={updater.updateCheckIntervalMinutes}
      updateChannel={updater.updateChannel}
      onUpdateChannelChange={updater.setUpdateChannel}
      updateChannelLocked={["preparing", "downloading", "ready"].includes(updater.status)}
      onUpdateCheckIntervalChange={updater.setUpdateCheckIntervalMinutes}
      musicBrainzFallbackTrackCount={musicBrainzFallbackTrackCount}
      onMusicBrainzFallbackTrackCountChange={(count) => {
        savePreference({
          musicBrainzFallbackTrackCount:
            normalizeMusicBrainzFallbackTrackCount(count),
        });
      }}
      localShares={sharing.shares}
      sharingError={sharing.error}
      onAddShare={sharing.addRoot}
      onRemoveShare={sharing.removeRoot}
      onSetShareEnabled={sharing.setRootEnabled}
      onRescanShares={sharing.rescan}
      onSetUploadSlots={sharing.setUploadSlots}
      onSetUploadPolicy={sharing.setUploadPolicy}
      maxConcurrentDownloads={transfers.snapshot.maxConcurrentDownloads}
      onSetMaxConcurrentDownloads={transfers.setMaxConcurrentDownloads}
      autoMirrorMinutes={transfers.snapshot.autoMirrorMinutes ?? 0}
      onSetAutoMirrorMinutes={transfers.setAutoMirrorMinutes}
      relaySuggestionMinutes={transfers.snapshot.relaySuggestionMinutes}
      onSetRelaySuggestionMinutes={transfers.setRelaySuggestionMinutes}
      soundcheckEnabled={transfers.snapshot.soundcheckEnabled}
      onSetSoundcheckEnabled={transfers.setSoundcheckEnabled}
      messageNotificationsEnabled={messages.notificationsEnabled}
      onMessageNotificationsChange={messages.setNotificationsEnabled}
      roomNotificationsEnabled={rooms.notificationsEnabled}
      onRoomNotificationsChange={rooms.setNotificationsEnabled}
    />
  );
}
