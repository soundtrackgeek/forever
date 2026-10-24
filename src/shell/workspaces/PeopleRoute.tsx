import { PeopleWorkspace } from "../../components/PeopleWorkspace";
import { useShell } from "../shellStore";

export default function PeopleRoute() {
  const {
    people,
    messages,
    selectedUsername,
    openPerson,
    browseUser,
    openMessages,
  } = useShell((s) => ({
    people: s.people,
    messages: s.messages,
    selectedUsername: s.selectedUsername,
    openPerson: s.openPerson,
    browseUser: s.browseUser,
    openMessages: s.openMessages,
  }));
  return (
    <PeopleWorkspace
      snapshot={people.snapshot}
      ready={people.ready}
      error={people.error ?? messages.error}
      selectedUsername={selectedUsername}
      onSelect={openPerson}
      onBrowseUser={browseUser}
      onSetFavorite={(username, favorite) =>
        void people.setFavorite(username, favorite).catch(() => undefined)
      }
      onSetBlocked={(username, blocked) =>
        void people.setBlocked(username, blocked).catch(() => undefined)
      }
      onSetIgnored={(username, ignored) =>
        void people.setIgnored(username, ignored).catch(() => undefined)
      }
      conversationUnreadCount={
        selectedUsername
          ? (messages.conversationByUsername(selectedUsername)?.unreadCount ??
            0)
          : 0
      }
      onMessageUser={openMessages}
      onDismissError={() => {
        people.clearError();
        messages.clearError();
      }}
    />
  );
}
