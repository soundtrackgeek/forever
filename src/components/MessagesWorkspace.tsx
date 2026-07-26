import {
  ArrowClockwise,
  BellSlash,
  ChatCircleDots,
  Check,
  Clock,
  DotsThree,
  EnvelopeOpen,
  EnvelopeSimple,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  Prohibit,
  Trash,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  MessagesSnapshot,
  PersonProfile,
  PrivateConversation,
  PrivateMessage,
} from "../types";
import { countryName } from "../utils/people";
import { CountryFlag } from "./CountryFlag";

export const MESSAGE_DRAFTS_STORAGE_KEY = "forever.messageDrafts.v1";
const MAX_SAVED_DRAFTS = 100;
const MAX_MESSAGE_LENGTH = 8_192;

type MessagesWorkspaceProps = {
  snapshot: MessagesSnapshot;
  ready: boolean;
  error: string | null;
  connectionOnline: boolean;
  selectedUsername: string | null;
  personByUsername: (username: string) => PersonProfile | null;
  onSelectUsername: (username: string | null) => void;
  onOpenConversation: (username: string) => Promise<void>;
  onSendMessage: (username: string, message: string) => Promise<void>;
  onRetryMessage: (id: string) => Promise<void>;
  onMarkRead: (username: string) => Promise<void>;
  onMarkUnread: (username: string) => Promise<void>;
  onClearConversation: (username: string) => Promise<void>;
  onRemoveConversation: (username: string) => Promise<void>;
  onSetIgnored: (username: string, ignored: boolean) => void;
  onSetBlocked: (username: string, blocked: boolean) => void;
  onOpenPerson: (username: string) => void;
  onDismissError: () => void;
};

const readDrafts = () => {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(MESSAGE_DRAFTS_STORAGE_KEY) ?? "{}",
    ) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([username, draft]) =>
            username.length <= 100 &&
            typeof draft === "string" &&
            draft.length <= MAX_MESSAGE_LENGTH,
        )
        .slice(0, MAX_SAVED_DRAFTS),
    ) as Record<string, string>;
  } catch {
    return {};
  }
};

const saveDrafts = (drafts: Record<string, string>) => {
  try {
    const bounded = Object.fromEntries(
      Object.entries(drafts)
        .filter(([, draft]) => draft.length > 0)
        .slice(-MAX_SAVED_DRAFTS),
    );
    window.localStorage.setItem(
      MESSAGE_DRAFTS_STORAGE_KEY,
      JSON.stringify(bounded),
    );
  } catch {
    // Drafts remain available for the current session when storage is unavailable.
  }
};

const formatListTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
};

const formatMessageTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

const formatMessageDay = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(timestamp);

const previewText = (conversation: PrivateConversation) => {
  const message = conversation.messages[conversation.messages.length - 1];
  if (!message) return "A quiet line is ready.";
  return `${message.direction === "outgoing" ? "You: " : ""}${message.body}`;
};

const profileStatus = (person: PersonProfile | null) => {
  if (!person || person.status === "unknown") return "Presence unknown";
  if (person.status === "online") return "Online now";
  if (person.status === "away") return "Away";
  return "Offline";
};

function InboxAvatar({ person, username }: { person: PersonProfile | null; username: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="person-avatar inbox-avatar">
      {person?.pictureDataUrl && !failed ? (
        <img src={person.pictureDataUrl} alt="" aria-hidden="true" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
      )}
      <i className={`presence-dot is-${person?.status ?? "unknown"}`} aria-hidden="true" />
    </span>
  );
}

function DeliveryState({
  message,
  onRetry,
}: {
  message: PrivateMessage;
  onRetry: (id: string) => Promise<void>;
}) {
  if (message.direction !== "outgoing") return null;
  if (message.delivery === "failed") {
    return (
      <span className="message-delivery is-failed" title={message.error ?? "Message failed"}>
        <WarningCircle size={11} weight="fill" /> Failed
        <button
          type="button"
          onClick={() => void onRetry(message.id).catch(() => undefined)}
        >
          <ArrowClockwise size={10} /> Retry
        </button>
      </span>
    );
  }
  if (message.delivery === "queued") {
    return <span className="message-delivery"><Clock size={10} /> Queued</span>;
  }
  return <span className="message-delivery"><Check size={10} weight="bold" /> Sent</span>;
}

export function MessagesWorkspace({
  snapshot,
  ready,
  error,
  connectionOnline,
  selectedUsername,
  personByUsername,
  onSelectUsername,
  onOpenConversation,
  onSendMessage,
  onRetryMessage,
  onMarkRead,
  onMarkUnread,
  onClearConversation,
  onRemoveConversation,
  onSetIgnored,
  onSetBlocked,
  onOpenPerson,
  onDismissError,
}: MessagesWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase());
  const [startingConversation, setStartingConversation] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newConversationError, setNewConversationError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(readDrafts);
  const [sending, setSending] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"clear" | "remove" | null>(null);
  const [followingTail, setFollowingTail] = useState(true);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const filteredConversations = useMemo(() => {
    if (!deferredQuery) return snapshot.conversations;
    return snapshot.conversations.filter(
      (conversation) =>
        conversation.username.toLocaleLowerCase().includes(deferredQuery) ||
        conversation.messages.some((message) =>
          message.body.toLocaleLowerCase().includes(deferredQuery),
        ),
    );
  }, [deferredQuery, snapshot.conversations]);

  const selectedConversation =
    snapshot.conversations.find(
      (conversation) =>
        conversation.username.toLocaleLowerCase() ===
        selectedUsername?.toLocaleLowerCase(),
    ) ?? filteredConversations[0] ?? snapshot.conversations[0] ?? null;
  const selectedPerson = selectedConversation
    ? personByUsername(selectedConversation.username)
    : null;
  const selectedKey = selectedConversation?.username.toLocaleLowerCase() ?? "";
  const draft = selectedKey ? drafts[selectedKey] ?? "" : "";

  useEffect(() => {
    saveDrafts(drafts);
  }, [drafts]);

  useEffect(() => {
    if (selectedConversation?.unreadCount) {
      void onMarkRead(selectedConversation.username).catch(() => undefined);
    }
  }, [onMarkRead, selectedConversation?.unreadCount, selectedConversation?.username]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedConversation?.username]);

  useEffect(() => {
    if (!followingTail) return;
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [followingTail, selectedConversation?.messages.length]);

  const selectConversation = (username: string | null) => {
    setMoreOpen(false);
    setConfirmAction(null);
    setFollowingTail(true);
    onSelectUsername(username);
  };

  const startConversation = async (event: FormEvent) => {
    event.preventDefault();
    const username = newUsername.trim();
    if (
      !username ||
      username.length > 100 ||
      ![...username].every((character) => character >= " " && character !== "\u007f")
    ) {
      setNewConversationError("Enter an exact Soulseek username.");
      return;
    }
    setNewConversationError(null);
    try {
      await onOpenConversation(username);
      selectConversation(username);
      setNewUsername("");
      setStartingConversation(false);
    } catch {
      // The shared inbox error presents native command failures.
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedConversation || !draft.trim() || sending || !connectionOnline) return;
    setSending(true);
    try {
      await onSendMessage(selectedConversation.username, draft);
      setDrafts((current) => {
        const next = { ...current };
        delete next[selectedKey];
        return next;
      });
      setFollowingTail(true);
    } catch {
      // The shared inbox error presents native command failures.
    } finally {
      setSending(false);
    }
  };

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const removeConversation = async () => {
    if (!selectedConversation) return;
    const currentIndex = snapshot.conversations.indexOf(selectedConversation);
    const next =
      snapshot.conversations[currentIndex + 1] ??
      snapshot.conversations[currentIndex - 1] ??
      null;
    await onRemoveConversation(selectedConversation.username);
    setDrafts((current) => {
      const updated = { ...current };
      delete updated[selectedKey];
      return updated;
    });
    selectConversation(next?.username ?? null);
    setMoreOpen(false);
    setConfirmAction(null);
  };

  return (
    <section className="messages-workspace" aria-label="Midnight Inbox">
      <header className="messages-heading">
        <div>
          <span className="eyebrow">Private transmission</span>
          <h1>Midnight Inbox</h1>
          <p>Quiet conversations with the people behind the files.</p>
        </div>
        <div className="messages-heading-status">
          <span className={connectionOnline ? "is-online" : "is-offline"}>
            <i aria-hidden="true" />
            {connectionOnline ? "Ready to send" : "Connect to send"}
          </span>
          <button type="button" onClick={() => setStartingConversation(true)}>
            <Plus size={15} weight="bold" /> New message
          </button>
        </div>
      </header>

      {error ? (
        <div className="people-error messages-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss inbox error">
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="messages-stage">
        <aside className="conversation-rail">
          <div className="conversation-search">
            <MagnifyingGlass size={14} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search conversations and messages"
              placeholder="Search conversations"
            />
            {searchQuery ? (
              <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear conversation search">
                <X size={12} />
              </button>
            ) : null}
          </div>

          {startingConversation ? (
            <form className="new-conversation" onSubmit={startConversation}>
              <label htmlFor="new-message-username">Exact Soulseek username</label>
              <div>
                <input
                  id="new-message-username"
                  autoFocus
                  maxLength={100}
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                  placeholder="listener_name"
                />
                <button type="submit" aria-label="Open new conversation">
                  <PaperPlaneTilt size={13} weight="fill" />
                </button>
              </div>
              {newConversationError ? <small role="alert">{newConversationError}</small> : null}
              <button type="button" className="cancel-new-conversation" onClick={() => setStartingConversation(false)}>
                Cancel
              </button>
            </form>
          ) : null}

          <div className="conversation-rail-label">
            <span>{deferredQuery ? `${filteredConversations.length} matches` : "Recent"}</span>
            <small>{snapshot.unreadCount ? `${snapshot.unreadCount} unread` : "All caught up"}</small>
          </div>

          <div className="conversation-list" aria-live="polite">
            {!ready ? (
              <div className="conversation-skeletons" aria-label="Loading conversations">
                <i /><i /><i />
              </div>
            ) : filteredConversations.length ? (
              filteredConversations.map((conversation, index) => {
                const person = personByUsername(conversation.username);
                const active =
                  conversation.username.toLocaleLowerCase() ===
                  selectedConversation?.username.toLocaleLowerCase();
                return (
                  <button
                    type="button"
                    className={`conversation-row ${active ? "is-active" : ""}`}
                    style={{ "--conversation-index": index } as CSSProperties}
                    onClick={() => selectConversation(conversation.username)}
                    key={conversation.username.toLocaleLowerCase()}
                  >
                    <InboxAvatar person={person} username={conversation.username} />
                    <span className="conversation-row-copy">
                      <span>
                        <strong>{conversation.username}</strong>
                        <time>{formatListTime(conversation.updatedAtMs)}</time>
                      </span>
                      <small>{previewText(conversation)}</small>
                    </span>
                    {conversation.unreadCount ? (
                      <b aria-label={`${conversation.unreadCount} unread messages`}>
                        {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                      </b>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="conversation-list-empty">
                <EnvelopeOpen size={22} weight="thin" />
                <strong>{deferredQuery ? "No matching transmission" : "Your inbox is quiet"}</strong>
                <span>{deferredQuery ? "Try a username or words from a message." : "Start with an exact Soulseek username."}</span>
              </div>
            )}
          </div>
        </aside>

        <div className="inbox-thread-pane">
          {selectedConversation ? (
            <>
              <header className="inbox-thread-header">
                <button
                  type="button"
                  className="inbox-profile-button"
                  onClick={() => onOpenPerson(selectedConversation.username)}
                >
                  <InboxAvatar person={selectedPerson} username={selectedConversation.username} />
                  <span>
                    <strong>{selectedConversation.username}</strong>
                    <small>
                      {profileStatus(selectedPerson)}
                      {selectedPerson?.countryCode ? ` · ${countryName(selectedPerson.countryCode)}` : ""}
                    </small>
                  </span>
                  {selectedPerson?.countryCode ? <CountryFlag code={selectedPerson.countryCode} /> : null}
                </button>

                <div className="inbox-thread-actions">
                  <button
                    type="button"
                    disabled={selectedConversation.messages.length === 0}
                    onClick={() =>
                      selectedConversation.unreadCount
                        ? void onMarkRead(selectedConversation.username).catch(() => undefined)
                        : void onMarkUnread(selectedConversation.username).catch(() => undefined)
                    }
                    title={selectedConversation.unreadCount ? "Mark read" : "Mark unread"}
                    aria-label={selectedConversation.unreadCount ? "Mark conversation read" : "Mark conversation unread"}
                  >
                    {selectedConversation.unreadCount ? <EnvelopeOpen size={15} /> : <EnvelopeSimple size={15} />}
                  </button>
                  {selectedPerson ? (
                    <>
                      <button
                        type="button"
                        className={selectedPerson.ignored ? "is-danger" : ""}
                        onClick={() => onSetIgnored(selectedConversation.username, !selectedPerson.ignored)}
                        title={selectedPerson.ignored ? "Unignore user" : "Ignore user"}
                        aria-label={selectedPerson.ignored ? "Unignore user" : "Ignore user"}
                      >
                        <BellSlash size={15} />
                      </button>
                      <button
                        type="button"
                        className={selectedPerson.blocked ? "is-danger" : ""}
                        onClick={() => onSetBlocked(selectedConversation.username, !selectedPerson.blocked)}
                        title={selectedPerson.blocked ? "Unban user" : "Ban user"}
                        aria-label={selectedPerson.blocked ? "Unban user" : "Ban user"}
                      >
                        <Prohibit size={15} />
                      </button>
                    </>
                  ) : null}
                  <div className="inbox-more-wrap">
                    <button
                      type="button"
                      onClick={() => setMoreOpen((open) => !open)}
                      aria-label="Conversation actions"
                      aria-expanded={moreOpen}
                    >
                      <DotsThree size={17} weight="bold" />
                    </button>
                    {moreOpen ? (
                      <div className="inbox-more-menu">
                        <button
                          type="button"
                          className={confirmAction === "clear" ? "is-confirming" : ""}
                          onClick={() => {
                            if (confirmAction !== "clear") {
                              setConfirmAction("clear");
                              return;
                            }
                            void onClearConversation(selectedConversation.username)
                              .then(() => {
                                setConfirmAction(null);
                                setMoreOpen(false);
                              })
                              .catch(() => undefined);
                          }}
                        >
                          <Trash size={13} /> {confirmAction === "clear" ? "Confirm clear history" : "Clear history"}
                        </button>
                        <button
                          type="button"
                          className={confirmAction === "remove" ? "is-confirming" : ""}
                          onClick={() => {
                            if (confirmAction !== "remove") {
                              setConfirmAction("remove");
                              return;
                            }
                            void removeConversation().catch(() => undefined);
                          }}
                        >
                          <X size={13} /> {confirmAction === "remove" ? "Confirm remove conversation" : "Remove conversation"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </header>

              <div
                className="inbox-thread-scroll"
                ref={threadRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  setFollowingTail(
                    target.scrollHeight - target.scrollTop - target.clientHeight < 72,
                  );
                }}
              >
                {selectedConversation.messages.length ? (
                  <ol className="inbox-message-list">
                    {selectedConversation.messages.map((message, index, messages) => {
                      const previous = messages[index - 1];
                      const showDay =
                        !previous ||
                        new Date(previous.sentAtMs).toDateString() !==
                          new Date(message.sentAtMs).toDateString();
                      return (
                        <Fragment key={message.id}>
                          {showDay ? <li className="message-day"><span>{formatMessageDay(message.sentAtMs)}</span></li> : null}
                          <li className={`inbox-message is-${message.direction} is-${message.delivery}`}>
                            <span className="inbox-message-bubble">{message.body}</span>
                            <span className="inbox-message-meta">
                              <time dateTime={new Date(message.sentAtMs).toISOString()}>
                                {formatMessageTime(message.sentAtMs)}
                              </time>
                              <DeliveryState message={message} onRetry={onRetryMessage} />
                            </span>
                          </li>
                        </Fragment>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="inbox-thread-empty">
                    <ChatCircleDots size={30} weight="thin" />
                    <h2>A quiet line is ready</h2>
                    <p>Write the first note. Soulseek will hold it if the listener is away.</p>
                  </div>
                )}
                {!followingTail ? (
                  <button
                    type="button"
                    className="jump-to-latest"
                    onClick={() => {
                      setFollowingTail(true);
                      const thread = threadRef.current;
                      if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
                    }}
                  >
                    Jump to latest
                  </button>
                ) : null}
              </div>

              <form className="inbox-composer" onSubmit={sendMessage}>
                <div className="inbox-composer-field">
                  <textarea
                    value={draft}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedKey]: event.target.value,
                      }))
                    }
                    onKeyDown={handleComposerKey}
                    disabled={!connectionOnline || sending}
                    maxLength={MAX_MESSAGE_LENGTH}
                    rows={2}
                    aria-label={`Message ${selectedConversation.username}`}
                    placeholder={connectionOnline ? `Message ${selectedConversation.username}` : "Connect to Soulseek to send"}
                  />
                  <span>
                    {draft.length > 7_000 ? `${draft.length.toLocaleString()} / ${MAX_MESSAGE_LENGTH.toLocaleString()}` : "Enter to send · Shift+Enter for a new line"}
                  </span>
                </div>
                <button type="submit" disabled={!connectionOnline || !draft.trim() || sending}>
                  <PaperPlaneTilt size={15} weight="fill" />
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className="inbox-zero-state">
              <span><UserCircle size={31} weight="thin" /></span>
              <h2>No transmission selected</h2>
              <p>Choose a conversation or begin one with an exact Soulseek username.</p>
              <button type="button" onClick={() => setStartingConversation(true)}>
                <Plus size={14} /> New message
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
