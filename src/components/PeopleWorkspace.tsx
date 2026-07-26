import {
  ArrowClockwise,
  BellSlash,
  ChatCircleDots,
  CheckCircle,
  FolderOpen,
  Heart,
  MagnifyingGlass,
  Prohibit,
  ShieldStar,
  SpinnerGap,
  UserCircle,
  Users,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  PeopleSnapshot,
  PersonProfile,
  PersonStatus,
  PrivateConversation,
} from "../types";
import { CountryFlag } from "./CountryFlag";
import { countryName } from "../utils/people";

type PeopleWorkspaceProps = {
  snapshot: PeopleSnapshot;
  ready: boolean;
  error: string | null;
  selectedUsername: string | null;
  onSelect: (username: string, refresh?: boolean) => void;
  onBrowseUser: (username: string) => void;
  onSetFavorite: (username: string, favorite: boolean) => void;
  onSetBlocked: (username: string, blocked: boolean) => void;
  onSetIgnored: (username: string, ignored: boolean) => void;
  conversation: PrivateConversation | null;
  connectionOnline: boolean;
  onSendMessage: (username: string, message: string) => Promise<void>;
  onMarkConversationRead: (username: string) => void;
  onDismissError: () => void;
};

const statusCopy: Record<PersonStatus, string> = {
  online: "Online now",
  away: "Away",
  offline: "Offline",
  unknown: "Presence unknown",
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard" }).format(value);

const formatSpeed = (bytesPerSecond: number) => {
  if (!bytesPerSecond) return "Not reported";
  const megabytes = bytesPerSecond / 1_000_000;
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB/s`;
};

const relativeSeen = (person: PersonProfile) => {
  if (person.status === "online") return "Here now";
  if (!person.lastSeenAtMs) return "Not seen this session";
  const elapsed = Math.max(0, Date.now() - person.lastSeenAtMs);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Seen just now";
  if (minutes < 60) return `Seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Seen ${hours}h ago`;
  return `Seen ${Math.floor(hours / 24)}d ago`;
};

function AvatarPicture({ person }: { person: PersonProfile }) {
  const [failed, setFailed] = useState(false);
  if (!person.pictureDataUrl || failed) {
    return <span aria-hidden="true">{person.username.slice(0, 1).toUpperCase()}</span>;
  }
  return (
    <img
      src={person.pictureDataUrl}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}

function PersonAvatar({ person, large = false }: { person: PersonProfile; large?: boolean }) {
  return (
    <span className={`person-avatar ${large ? "is-large" : ""}`}>
      <AvatarPicture key={`${person.username}-${person.pictureDataUrl ?? "initial"}`} person={person} />
      <i className={`presence-dot is-${person.status}`} aria-hidden="true" />
    </span>
  );
}

const formatMessageTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);

export function PeopleWorkspace({
  snapshot,
  ready,
  error,
  selectedUsername,
  onSelect,
  onBrowseUser,
  onSetFavorite,
  onSetBlocked,
  onSetIgnored,
  conversation,
  connectionOnline,
  onSendMessage,
  onMarkConversationRead,
  onDismissError,
}: PeopleWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [listMode, setListMode] = useState<"all" | "favorites">("all");
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const selected = snapshot.users.find(
    (person) =>
      person.username.toLocaleLowerCase() === selectedUsername?.toLocaleLowerCase(),
  ) ?? snapshot.users[0] ?? null;

  const visiblePeople = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return snapshot.users.filter(
      (person) =>
        (listMode === "all" || person.favorite) &&
        (!needle || person.username.toLocaleLowerCase().includes(needle)),
    );
  }, [listMode, query, snapshot.users]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const username = query.trim();
    if (username) onSelect(username, true);
  };

  const openMessages = () => {
    if (!selected) return;
    setMessageOpen(true);
    onMarkConversationRead(selected.username);
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !messageDraft.trim() || messageSending || !connectionOnline) return;
    setMessageSending(true);
    try {
      await onSendMessage(selected.username, messageDraft);
      setMessageDraft("");
    } catch {
      // The shared people error banner presents the command failure.
    } finally {
      setMessageSending(false);
    }
  };

  return (
    <section className="people-workspace" aria-label="People and presence">
      <header className="people-heading">
        <div>
          <span className="eyebrow">People &amp; presence</span>
          <h1>Your corner of the network</h1>
          <p>Remember good sources, see who is around, and learn what they share.</p>
        </div>
        <form className="people-lookup" onSubmit={submit}>
          <MagnifyingGlass size={17} weight="light" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a Soulseek username"
            aria-label="Find a Soulseek username"
            maxLength={100}
          />
          <button type="submit" disabled={!query.trim()}>Open</button>
        </form>
      </header>

      {error && (
        <div className="people-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss people error">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="people-stage">
        <aside className="people-rail">
          <div className="people-rail-summary">
            <span><strong>{snapshot.onlineFavoriteCount}</strong> favorites online</span>
            <span><strong>{snapshot.favoriteCount}</strong> saved</span>
          </div>
          <div className="people-list-tabs" aria-label="People filters">
            <button
              type="button"
              className={listMode === "all" ? "is-active" : ""}
              onClick={() => setListMode("all")}
            >
              Recent
            </button>
            <button
              type="button"
              className={listMode === "favorites" ? "is-active" : ""}
              onClick={() => setListMode("favorites")}
            >
              Favorites
            </button>
          </div>

          <div className="people-list" aria-live="polite">
            {!ready ? (
              <div className="people-list-loading">
                <i /><i /><i />
              </div>
            ) : visiblePeople.length === 0 ? (
              <div className="people-list-empty">
                <Users size={24} weight="light" />
                <strong>{query ? "No saved match" : "Nobody here yet"}</strong>
                <span>{query ? "Press Open to request this profile." : "Open a source from search to remember them."}</span>
              </div>
            ) : (
              visiblePeople.map((person) => (
                <button
                  type="button"
                  className={`person-list-row ${selected?.username === person.username ? "is-active" : ""}`}
                  onClick={() => onSelect(person.username)}
                  key={person.username}
                >
                  <PersonAvatar person={person} />
                  <span>
                    <strong>{person.username}</strong>
                    <small>{relativeSeen(person)}</small>
                  </span>
                  <CountryFlag code={person.countryCode} />
                  {person.favorite && <Heart className="person-favorite-mark" size={12} weight="fill" aria-label="Favorite" />}
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="person-profile-pane">
          {!selected ? (
            <div className="person-profile-empty">
              <UserCircle size={44} weight="thin" />
              <h2>Choose someone to tune in</h2>
              <p>Select a remembered listener or enter an exact Soulseek username.</p>
            </div>
          ) : (
            <>
              <div className="person-profile-hero">
                <PersonAvatar person={selected} large />
                <div className="person-profile-title">
                  <span className={`person-status is-${selected.status}`}>
                    <i aria-hidden="true" /> {statusCopy[selected.status]}
                  </span>
                  <h2>{selected.username}</h2>
                  <CountryFlag code={selected.countryCode} showName />
                  {selected.privileged && (
                    <span className="privileged-listener"><ShieldStar size={13} weight="fill" /> Supporting listener</span>
                  )}
                </div>
                <div className="person-primary-actions">
                  <button
                    type="button"
                    className={`favorite-person ${selected.favorite ? "is-active" : ""}`}
                    aria-pressed={selected.favorite}
                    onClick={() => onSetFavorite(selected.username, !selected.favorite)}
                  >
                    <Heart size={17} weight={selected.favorite ? "fill" : "regular"} />
                    {selected.favorite ? "Saved" : "Save"}
                  </button>
                  <button type="button" onClick={openMessages}>
                    <ChatCircleDots size={17} /> Message
                    {conversation && conversation.unreadCount > 0 ? (
                      <span className="message-unread-count" aria-hidden="true">{conversation.unreadCount}</span>
                    ) : null}
                  </button>
                  <button type="button" className="profile-browse-action" onClick={() => onBrowseUser(selected.username)}>
                    <FolderOpen size={17} /> Browse shares
                  </button>
                </div>
              </div>

              {selected.profileState === "loading" ? (
                <div className="person-profile-loading">
                  <SpinnerGap className="is-spinning" size={24} />
                  <strong>Listening for {selected.username}</strong>
                  <span>Requesting profile, interests, and live share details.</span>
                </div>
              ) : selected.profileState === "error" || selected.profileState === "unavailable" ? (
                <div className="person-profile-unavailable">
                  <Waveform size={27} weight="light" />
                  <strong>Profile signal unavailable</strong>
                  <span>{selected.error ?? "This listener did not answer the profile request."}</span>
                  <button type="button" onClick={() => onSelect(selected.username, true)}>
                    <ArrowClockwise size={15} /> Try again
                  </button>
                </div>
              ) : (
                <div className="person-profile-content">
                  <section className="person-note">
                    <span className="section-label">About</span>
                    <p>{selected.description || "This listener has not written a profile note."}</p>
                  </section>

                  <dl className="person-stats">
                    <div><dt>Shared files</dt><dd>{formatNumber(selected.sharedFileCount)}</dd></div>
                    <div><dt>Folders</dt><dd>{formatNumber(selected.sharedDirectoryCount)}</dd></div>
                    <div><dt>Upload speed</dt><dd>{formatSpeed(selected.averageSpeed)}</dd></div>
                    <div><dt>Upload slots</dt><dd>{selected.uploadSlots == null ? "Not reported" : formatNumber(selected.uploadSlots)}</dd></div>
                    <div><dt>Slot available</dt><dd>{selected.slotsFree == null ? "Not reported" : selected.slotsFree ? "Yes" : "No"}</dd></div>
                    <div><dt>Queued uploads</dt><dd>{selected.queueSize == null ? "Not reported" : formatNumber(selected.queueSize)}</dd></div>
                  </dl>

                  <div className="person-taste-grid">
                    <section>
                      <span className="section-label">Into</span>
                      <div className="interest-cloud">
                        {selected.likes.length ? selected.likes.map((interest) => <span key={interest}>{interest}</span>) : <small>No likes listed</small>}
                      </div>
                    </section>
                    <section>
                      <span className="section-label">Avoids</span>
                      <div className="interest-cloud is-muted">
                        {selected.hates.length ? selected.hates.map((interest) => <span key={interest}>{interest}</span>) : <small>Nothing listed</small>}
                      </div>
                    </section>
                  </div>

                  <footer className="person-profile-footer">
                    <span><CheckCircle size={14} weight="fill" /> Profile details are session-only; favorites remain on this device.</span>
                    <div className="person-safety-actions">
                      <button
                        type="button"
                        className={selected.ignored ? "is-blocked" : ""}
                        onClick={() => onSetIgnored(selected.username, !selected.ignored)}
                        title="Hide this user's private messages and search activity on this device."
                      >
                        <BellSlash size={14} /> {selected.ignored ? "Unignore user" : "Ignore user"}
                      </button>
                      <button
                        type="button"
                        className={selected.blocked ? "is-blocked" : ""}
                        onClick={() => onSetBlocked(selected.username, !selected.blocked)}
                        title="Prevent this user from browsing or downloading your shares."
                      >
                        <Prohibit size={14} /> {selected.blocked ? "Unban user" : "Ban user"}
                      </button>
                    </div>
                  </footer>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {messageOpen && selected && (
        <div className="message-shell-backdrop" role="presentation" onMouseDown={() => setMessageOpen(false)}>
          <section className="message-shell" role="dialog" aria-modal="true" aria-labelledby="message-shell-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <PersonAvatar person={selected} />
              <span><strong id="message-shell-title">{selected.username}</strong><small>{statusCopy[selected.status]} · {countryName(selected.countryCode)}</small></span>
              <button type="button" aria-label="Close conversation" onClick={() => setMessageOpen(false)}><X size={16} /></button>
            </header>
            <div className={`message-shell-body ${conversation?.messages.length ? "has-messages" : ""}`} aria-live="polite">
              {conversation?.messages.length ? (
                <ol className="message-thread">
                  {conversation.messages.map((message) => (
                    <li className={`is-${message.direction}`} key={message.id}>
                      <span>{message.body}</span>
                      <time dateTime={new Date(message.sentAtMs).toISOString()}>{formatMessageTime(message.sentAtMs)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="message-empty-state">
                  <ChatCircleDots size={32} weight="thin" />
                  <h3>A quiet line is ready</h3>
                  <p>Messages stay private, persist on this device, and can be delivered when the listener returns.</p>
                </div>
              )}
            </div>
            <form className="message-composer" onSubmit={sendMessage}>
              <input
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                disabled={!connectionOnline || messageSending}
                placeholder={connectionOnline ? `Message ${selected.username}` : "Connect to send a message"}
                aria-label={`Message ${selected.username}`}
                maxLength={8192}
                autoFocus
              />
              <button type="submit" disabled={!connectionOnline || !messageDraft.trim() || messageSending}>
                {messageSending ? "Sending…" : "Send"}
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
