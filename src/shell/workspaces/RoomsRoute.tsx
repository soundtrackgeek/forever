import { RoomsWorkspace } from "../../components/RoomsWorkspace";
import { useShell } from "../shellStore";

export default function RoomsRoute() {
  const { roomFocus, rooms, people, openPerson, openMessages, browseUser } =
    useShell((s) => ({
      roomFocus: s.roomFocus,
      rooms: s.rooms,
      people: s.people,
      openPerson: s.openPerson,
      openMessages: s.openMessages,
      browseUser: s.browseUser,
    }));
  return (
    <RoomsWorkspace
      key={roomFocus?.requestId ?? "rooms"}
      initialRoomName={roomFocus?.roomName ?? null}
      snapshot={rooms.snapshot}
      ready={rooms.ready}
      error={rooms.error ?? people.error}
      people={people.snapshot}
      onRefresh={rooms.refresh}
      onJoin={rooms.join}
      onLeave={rooms.leave}
      onSend={rooms.send}
      onMarkRead={rooms.markRead}
      onSetRoomFavorite={rooms.setFavorite}
      onOpenPerson={openPerson}
      onMessageUser={openMessages}
      onBrowseUser={browseUser}
      onSetPersonFavorite={(username, favorite) =>
        void people.setFavorite(username, favorite).catch(() => undefined)
      }
      onSetIgnored={(username, ignored) =>
        void people.setIgnored(username, ignored).catch(() => undefined)
      }
      onSetBlocked={(username, blocked) =>
        void people.setBlocked(username, blocked).catch(() => undefined)
      }
      onDismissError={() => {
        rooms.clearError();
        people.clearError();
      }}
    />
  );
}
