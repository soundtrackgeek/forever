import {
  ArrowsClockwise,
  BellSlash,
  ChatCircleDots,
  DoorOpen,
  FolderOpen,
  Hash,
  Heart,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  Prohibit,
  Star,
  UserCircle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  PeopleSnapshot,
  PersonProfile,
  RoomMember,
  RoomsSnapshot,
  SoulseekRoom,
} from "../types";
import { CountryFlag } from "./CountryFlag";

type RoomsWorkspaceProps = {
  snapshot: RoomsSnapshot;
  ready: boolean;
  error: string | null;
  people: PeopleSnapshot;
  onRefresh: () => Promise<unknown>;
  onJoin: (room: string) => Promise<unknown>;
  onLeave: (room: string) => Promise<unknown>;
  onSend: (room: string, message: string) => Promise<unknown>;
  onMarkRead: (room: string) => Promise<unknown>;
  onSetRoomFavorite: (room: string, favorite: boolean) => Promise<unknown>;
  onOpenPerson: (username: string) => void;
  onMessageUser: (username: string) => void;
  onBrowseUser: (username: string) => void;
  onSetPersonFavorite: (username: string, favorite: boolean) => void;
  onSetIgnored: (username: string, ignored: boolean) => void;
  onSetBlocked: (username: string, blocked: boolean) => void;
  onDismissError: () => void;
};

type RoomFilter = "joined" | "favorites" | "all";

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);

const formatSpeed = (bytesPerSecond: number) => {
  if (!bytesPerSecond) return "—";
  const megabytes = bytesPerSecond / 1_000_000;
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB/s`;
};

const formatMessageTime = (timestamp: number) =>
  new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

const statusName = (status: number) =>
  status === 2 ? "Online" : status === 1 ? "Away" : "Offline";

const findPerson = (people: PeopleSnapshot, username: string) =>
  people.users.find(
    (person) =>
      person.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
  ) ?? null;

function RoomDirectoryRow({
  room,
  selected,
  onSelect,
}: {
  room: SoulseekRoom;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`room-directory-row ${selected ? "is-active" : ""}`}
      onClick={onSelect}
    >
      <span className="room-directory-mark">
        <Hash size={15} weight={room.joined ? "bold" : "regular"} />
      </span>
      <span className="room-directory-copy">
        <strong>{room.name}</strong>
        <small>{formatNumber(room.userCount)} listening</small>
      </span>
      {room.favorite ? <Star size={12} weight="fill" aria-label="Favorite room" /> : null}
      {room.unreadCount > 0 ? (
        <b className={room.mentionCount > 0 ? "is-mention" : ""}>
          {room.unreadCount > 99 ? "99+" : room.unreadCount}
        </b>
      ) : null}
    </button>
  );
}

function MemberRow({
  member,
  selected,
  onSelect,
}: {
  member: RoomMember;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`room-member-row ${selected ? "is-active" : ""}`}
      onClick={onSelect}
    >
      <span className="room-member-avatar" aria-hidden="true">
        {member.username.slice(0, 1).toUpperCase()}
        <i className={`is-status-${member.status}`} />
      </span>
      <span className="room-member-copy">
        <strong>{member.username}</strong>
        <small>{member.slotsFree ? "Slot open" : "Queue only"} · {formatSpeed(member.averageSpeed)}</small>
      </span>
      <CountryFlag code={member.countryCode} />
    </button>
  );
}

function MemberInspector({
  member,
  person,
  onOpenPerson,
  onMessageUser,
  onBrowseUser,
  onSetFavorite,
  onSetIgnored,
  onSetBlocked,
}: {
  member: RoomMember;
  person: PersonProfile | null;
  onOpenPerson: () => void;
  onMessageUser: () => void;
  onBrowseUser: () => void;
  onSetFavorite: () => void;
  onSetIgnored: () => void;
  onSetBlocked: () => void;
}) {
  return (
    <section className="room-member-inspector" aria-label={`${member.username} room member details`}>
      <header>
        <span className="room-member-avatar is-large" aria-hidden="true">
          {member.username.slice(0, 1).toUpperCase()}
          <i className={`is-status-${member.status}`} />
        </span>
        <div>
          <span>{statusName(member.status)}</span>
          <strong>{member.username}</strong>
          <CountryFlag code={member.countryCode} showName />
        </div>
      </header>
      <dl>
        <div><dt>Availability</dt><dd>{member.slotsFree ? "Upload slot open" : "Queue only"}</dd></div>
        <div><dt>Speed</dt><dd>{formatSpeed(member.averageSpeed)}</dd></div>
        <div><dt>Shared files</dt><dd>{formatNumber(member.sharedFileCount)}</dd></div>
        <div><dt>Folders</dt><dd>{formatNumber(member.sharedDirectoryCount)}</dd></div>
      </dl>
      <div className="room-member-primary-actions">
        <button type="button" onClick={onOpenPerson}><UserCircle size={15} /> Profile</button>
        <button type="button" onClick={onMessageUser}><ChatCircleDots size={15} /> Message</button>
        <button type="button" onClick={onBrowseUser}><FolderOpen size={15} /> Browse</button>
      </div>
      <div className="room-member-safety-actions">
        <button type="button" className={person?.favorite ? "is-active" : ""} onClick={onSetFavorite}>
          <Heart size={14} weight={person?.favorite ? "fill" : "regular"} /> {person?.favorite ? "Saved" : "Save user"}
        </button>
        <button type="button" className={person?.ignored ? "is-active" : ""} onClick={onSetIgnored}>
          <BellSlash size={14} /> {person?.ignored ? "Unignore" : "Ignore"}
        </button>
        <button type="button" className={person?.blocked ? "is-active" : ""} onClick={onSetBlocked}>
          <Prohibit size={14} /> {person?.blocked ? "Unban" : "Ban"}
        </button>
      </div>
    </section>
  );
}

export function RoomsWorkspace({
  snapshot,
  ready,
  error,
  people,
  onRefresh,
  onJoin,
  onLeave,
  onSend,
  onMarkRead,
  onSetRoomFavorite,
  onOpenPerson,
  onMessageUser,
  onBrowseUser,
  onSetPersonFavorite,
  onSetIgnored,
  onSetBlocked,
  onDismissError,
}: RoomsWorkspaceProps) {
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("joined");
  const [roomQuery, setRoomQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedRoomName, setSelectedRoomName] = useState<string | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState<string | null>(null);
  const [joinRoomName, setJoinRoomName] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const messageEnd = useRef<HTMLDivElement>(null);

  const selectedRoom = snapshot.rooms.find(
    (room) =>
      room.name.toLocaleLowerCase() === selectedRoomName?.toLocaleLowerCase(),
  ) ?? snapshot.rooms.find((room) => room.joined) ?? snapshot.rooms[0] ?? null;

  useEffect(() => {
    if (!selectedRoom) return;
    if (selectedRoom.unreadCount > 0) {
      void onMarkRead(selectedRoom.name).catch(() => undefined);
    }
  }, [onMarkRead, selectedRoom, selectedRoomName]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView?.({ block: "end" });
  }, [selectedRoom?.messages.length]);

  const visibleRooms = useMemo(() => {
    const needle = roomQuery.trim().toLocaleLowerCase();
    return snapshot.rooms.filter((room) => {
      const inFilter =
        roomFilter === "all" ||
        (roomFilter === "joined" && room.joined) ||
        (roomFilter === "favorites" && room.favorite);
      return inFilter && (!needle || room.name.toLocaleLowerCase().includes(needle));
    });
  }, [roomFilter, roomQuery, snapshot.rooms]);

  const visibleMembers = useMemo(() => {
    const needle = memberQuery.trim().toLocaleLowerCase();
    return (selectedRoom?.members ?? []).filter(
      (member) => !needle || member.username.toLocaleLowerCase().includes(needle),
    );
  }, [memberQuery, selectedRoom?.members]);

  const selectedMember = visibleMembers.find(
    (member) =>
      member.username.toLocaleLowerCase() === selectedMemberName?.toLocaleLowerCase(),
  ) ?? null;
  const selectedPerson = selectedMember
    ? findPerson(people, selectedMember.username)
    : null;

  const submitJoin = async (event: FormEvent) => {
    event.preventDefault();
    const room = joinRoomName.trim();
    if (!room) return;
    await onJoin(room);
    setSelectedRoomName(room);
    setJoinRoomName("");
    setShowJoin(false);
    setRoomFilter("joined");
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRoom?.joined || !draft.trim() || sending) return;
    setSending(true);
    try {
      await onSend(selectedRoom.name, draft.trim());
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const chooseRoom = (room: SoulseekRoom) => {
    setSelectedRoomName(room.name);
    setSelectedMemberName(null);
    if (room.unreadCount > 0) void onMarkRead(room.name).catch(() => undefined);
  };

  return (
    <section className="rooms-workspace" aria-label="Public Soulseek rooms">
      <header className="rooms-heading">
        <div>
          <span className="eyebrow">Open frequency</span>
          <h1>Rooms</h1>
          <p>Drop into the live network, trade notes, and find listeners worth remembering.</p>
        </div>
        <div className="rooms-heading-actions">
          <span className={snapshot.connected ? "is-online" : ""}><i /> {snapshot.connected ? "Network live" : "Offline"}</span>
          <button type="button" onClick={() => void onRefresh().catch(() => undefined)} disabled={!snapshot.connected}>
            <ArrowsClockwise size={16} /> Refresh
          </button>
          <button type="button" className="primary-action" onClick={() => setShowJoin((open) => !open)} disabled={!snapshot.connected}>
            <Plus size={16} /> Join room
          </button>
        </div>
      </header>

      <div className="rooms-notices">
        {showJoin ? (
          <form className="room-join-strip" onSubmit={(event) => void submitJoin(event)}>
          <Hash size={17} />
          <input
            value={joinRoomName}
            onChange={(event) => setJoinRoomName(event.target.value)}
            placeholder="Public room name"
            aria-label="Public room name"
            maxLength={24}
            autoFocus
          />
          <span>1–24 ASCII characters</span>
          <button type="submit" disabled={!joinRoomName.trim()}>Tune in</button>
          <button type="button" aria-label="Close join room" onClick={() => setShowJoin(false)}><X size={15} /></button>
          </form>
        ) : null}

        {error ? (
          <div className="rooms-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onDismissError} aria-label="Dismiss room error"><X size={14} /></button>
          </div>
        ) : null}
      </div>

      <div className="rooms-stage">
        <aside className="room-directory">
          <label className="room-search-field">
            <MagnifyingGlass size={15} />
            <input value={roomQuery} onChange={(event) => setRoomQuery(event.target.value)} placeholder="Search rooms" />
          </label>
          <div className="room-directory-tabs" aria-label="Room filters">
            {(["joined", "favorites", "all"] as const).map((filter) => (
              <button type="button" className={roomFilter === filter ? "is-active" : ""} onClick={() => setRoomFilter(filter)} key={filter}>
                {filter === "joined" ? "Joined" : filter === "favorites" ? "Stars" : "All"}
              </button>
            ))}
          </div>
          <div className="room-directory-list">
            {!ready ? <div className="rooms-loading"><i /><i /><i /></div> : visibleRooms.length ? (
              visibleRooms.map((room) => (
                <RoomDirectoryRow
                  room={room}
                  selected={selectedRoom?.name === room.name}
                  onSelect={() => chooseRoom(room)}
                  key={room.name}
                />
              ))
            ) : (
              <div className="room-directory-empty">
                <Hash size={24} weight="light" />
                <strong>No rooms on this dial</strong>
                <span>Try another filter or join a public room by name.</span>
              </div>
            )}
          </div>
        </aside>

        <main className="room-conversation">
          {!selectedRoom ? (
            <div className="room-conversation-empty">
              <UsersThree size={45} weight="thin" />
              <h2>The room dial is quiet</h2>
              <p>Connect and choose a public room to hear the conversation.</p>
            </div>
          ) : (
            <>
              <header className="room-conversation-heading">
                <span className="room-channel-icon"><Hash size={19} /></span>
                <div>
                  <h2>{selectedRoom.name}</h2>
                  <span>{formatNumber(selectedRoom.userCount)} listeners · {selectedRoom.joined ? "joined" : "previewing directory"}</span>
                </div>
                <button
                  type="button"
                  className={selectedRoom.favorite ? "is-active" : ""}
                  aria-label={selectedRoom.favorite ? "Remove room favorite" : "Favorite room"}
                  aria-pressed={selectedRoom.favorite}
                  onClick={() => void onSetRoomFavorite(selectedRoom.name, !selectedRoom.favorite).catch(() => undefined)}
                >
                  <Star size={17} weight={selectedRoom.favorite ? "fill" : "regular"} />
                </button>
                {selectedRoom.joined ? (
                  <button type="button" onClick={() => void onLeave(selectedRoom.name).catch(() => undefined)}><DoorOpen size={16} /> Leave</button>
                ) : (
                  <button type="button" className="primary-action" onClick={() => void onJoin(selectedRoom.name).catch(() => undefined)} disabled={!snapshot.connected || selectedRoom.joining}>
                    <Plus size={16} /> {selectedRoom.joining ? "Joining…" : "Join"}
                  </button>
                )}
              </header>

              <div className="room-message-feed" aria-live="polite">
                {!selectedRoom.joined ? (
                  <div className="room-signal-note">
                    <Hash size={22} />
                    <strong>Join to hear this frequency</strong>
                    <span>Room history starts when you join and remains bounded on this device.</span>
                  </div>
                ) : selectedRoom.messages.length ? (
                  selectedRoom.messages.map((message, index) => {
                    const previous = selectedRoom.messages[index - 1];
                    const grouped = previous?.username === message.username && message.sentAtMs - previous.sentAtMs < 180_000;
                    const member = selectedRoom.members.find((item) => item.username === message.username);
                    return (
                      <article className={`room-message ${message.own ? "is-own" : ""} ${message.mention ? "is-mention" : ""} ${grouped ? "is-grouped" : ""}`} key={message.id}>
                        {!grouped ? (
                          <span className="room-message-avatar" aria-hidden="true">{message.username.slice(0, 1).toUpperCase()}</span>
                        ) : <span />}
                        <div>
                          {!grouped ? (
                            <header>
                              <button type="button" onClick={() => onOpenPerson(message.username)}>{message.username}</button>
                              <CountryFlag code={member?.countryCode} />
                              <time>{formatMessageTime(message.sentAtMs)}</time>
                              {message.mention ? <b>Mention</b> : null}
                            </header>
                          ) : null}
                          <p>{message.body}</p>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="room-signal-note">
                    <ChatCircleDots size={24} />
                    <strong>A clear channel</strong>
                    <span>Be the first listener to say something.</span>
                  </div>
                )}
                <div ref={messageEnd} />
              </div>

              <form className="room-composer" onSubmit={(event) => void submitMessage(event)}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={selectedRoom.joined ? `Message #${selectedRoom.name}` : "Join this room to write"}
                  aria-label={`Message ${selectedRoom.name}`}
                  disabled={!selectedRoom.joined || !snapshot.connected}
                  maxLength={4096}
                  rows={1}
                />
                <span>{draft.length}/4096 · Shift+Enter for a new line</span>
                <button type="submit" aria-label="Send room message" disabled={!draft.trim() || sending || !selectedRoom.joined || !snapshot.connected}>
                  <PaperPlaneTilt size={18} weight="fill" />
                </button>
              </form>
            </>
          )}
        </main>

        <aside className="room-members">
          {selectedMember ? (
            <>
              <button type="button" className="room-member-back" onClick={() => setSelectedMemberName(null)}><X size={14} /> Close details</button>
              <MemberInspector
                member={selectedMember}
                person={selectedPerson}
                onOpenPerson={() => onOpenPerson(selectedMember.username)}
                onMessageUser={() => onMessageUser(selectedMember.username)}
                onBrowseUser={() => onBrowseUser(selectedMember.username)}
                onSetFavorite={() => onSetPersonFavorite(selectedMember.username, !selectedPerson?.favorite)}
                onSetIgnored={() => onSetIgnored(selectedMember.username, !selectedPerson?.ignored)}
                onSetBlocked={() => onSetBlocked(selectedMember.username, !selectedPerson?.blocked)}
              />
            </>
          ) : (
            <>
              <header>
                <span>Listeners</span>
                <strong>{formatNumber(selectedRoom?.members.length ?? 0)}</strong>
              </header>
              <label className="room-search-field">
                <MagnifyingGlass size={14} />
                <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Find listener" />
              </label>
              <div className="room-member-list">
                {visibleMembers.length ? visibleMembers.map((member) => (
                  <MemberRow member={member} selected={false} onSelect={() => setSelectedMemberName(member.username)} key={member.username} />
                )) : (
                  <div className="room-members-empty">
                    <UsersThree size={24} weight="light" />
                    <span>{selectedRoom?.joined ? "No matching listeners" : "Join to see listeners"}</span>
                  </div>
                )}
              </div>
              <footer><i className="is-status-2" /> Online <i className="is-status-1" /> Away</footer>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
