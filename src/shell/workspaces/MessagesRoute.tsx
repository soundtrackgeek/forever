import { MessagesWorkspace } from "../../components/MessagesWorkspace";
import { useShell } from "../shellStore";

export default function MessagesRoute() {
  const {
    messages,
    people,
    connection,
    selectedMessageUsername,
    setSelectedMessageUsername,
    openPerson,
  } = useShell((s) => ({
    messages: s.messages,
    people: s.people,
    connection: s.connection,
    selectedMessageUsername: s.selectedMessageUsername,
    setSelectedMessageUsername: s.setSelectedMessageUsername,
    openPerson: s.openPerson,
  }));
  return (
    <MessagesWorkspace
      snapshot={messages.snapshot}
      ready={messages.ready}
      error={messages.error ?? people.error}
      connectionOnline={connection.snapshot.state === "online"}
      selectedUsername={selectedMessageUsername}
      personByUsername={people.personByUsername}
      onSelectUsername={setSelectedMessageUsername}
      onOpenConversation={async (username) => {
        await messages.openConversation(username);
        if (connection.snapshot.state === "online") {
          void people.openProfile(username).catch(() => undefined);
        }
      }}
      onSendMessage={messages.send}
      onRetryMessage={messages.retry}
      onMarkRead={messages.markRead}
      onMarkUnread={messages.markUnread}
      onClearConversation={messages.clearConversation}
      onRemoveConversation={messages.removeConversation}
      onSetIgnored={(username, ignored) =>
        void people.setIgnored(username, ignored).catch(() => undefined)
      }
      onSetBlocked={(username, blocked) =>
        void people.setBlocked(username, blocked).catch(() => undefined)
      }
      onOpenPerson={openPerson}
      onDismissError={() => {
        messages.clearError();
        people.clearError();
      }}
    />
  );
}
