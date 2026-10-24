import { AppSidebar } from "../../components/AppSidebar";
import { useShell } from "../shellStore";

export default function Sidebar() {
  const {
    activeView,
    status,
    username,
    connectionState,
    unreadMessages,
    unreadRooms,
    navigate,
    checkForUpdates,
  } = useShell((s) => ({
    activeView: s.activeView,
    status: s.updater.status,
    username: s.connection.snapshot.username,
    connectionState: s.connection.snapshot.state,
    unreadMessages: s.messages.snapshot.unreadCount,
    unreadRooms: s.rooms.snapshot.unreadCount,
    navigate: s.navigate,
    checkForUpdates: s.updater.checkForUpdates,
  }));
  return (
    <AppSidebar
      activeView={activeView}
      updateStatus={status}
      username={username}
      connectionState={connectionState}
      unreadMessages={unreadMessages}
      unreadRooms={unreadRooms}
      onNavigate={navigate}
      onCheckForUpdates={() => void checkForUpdates(true)}
    />
  );
}
