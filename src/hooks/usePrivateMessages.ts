import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessagesSnapshot, PrivateConversation, PrivateMessage } from "../types";

export const MESSAGE_NOTIFICATION_STORAGE_KEY =
  "forever.messageNotificationsEnabled";

const now = Date.now();
const previewConversations: PrivateConversation[] = [
  {
    username: "audiophile92",
    unreadCount: 1,
    updatedAtMs: now - 45_000,
    messages: [
      {
        id: "preview-audio-incoming",
        serverId: 1,
        username: "audiophile92",
        body: "Hi — I found that late-night radio session you were looking for.",
        direction: "incoming",
        sentAtMs: now - 180_000,
        unread: true,
        delivery: "received",
        error: null,
      },
      {
        id: "preview-audio-outgoing",
        serverId: null,
        username: "audiophile92",
        body: "That sounds perfect. Is it the full broadcast?",
        direction: "outgoing",
        sentAtMs: now - 120_000,
        unread: false,
        delivery: "sent",
        error: null,
      },
      {
        id: "preview-audio-reply",
        serverId: 2,
        username: "audiophile92",
        body: "The full ninety minutes, including the station ident at the end.",
        direction: "incoming",
        sentAtMs: now - 45_000,
        unread: true,
        delivery: "received",
        error: null,
      },
    ],
  },
  {
    username: "vinyljunkie",
    unreadCount: 0,
    updatedAtMs: now - 3_600_000,
    messages: [
      {
        id: "preview-vinyl-incoming",
        serverId: 3,
        username: "vinyljunkie",
        body: "I left the original cue-sheet scans beside the FLACs.",
        direction: "incoming",
        sentAtMs: now - 3_780_000,
        unread: false,
        delivery: "received",
        error: null,
      },
      {
        id: "preview-vinyl-failed",
        serverId: null,
        username: "vinyljunkie",
        body: "Brilliant, thank you. I will keep them with the release.",
        direction: "outgoing",
        sentAtMs: now - 3_600_000,
        unread: false,
        delivery: "failed",
        error: "The Soulseek connection was interrupted before this message was sent.",
      },
    ],
  },
];

const emptySnapshot = (): MessagesSnapshot => ({
  conversations: [],
  unreadCount: 0,
  updatedAtMs: Date.now(),
});

const previewSnapshot = (): MessagesSnapshot => ({
  conversations: previewConversations,
  unreadCount: previewConversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  ),
  updatedAtMs: now,
});

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const readNotificationPreference = () => {
  try {
    return window.localStorage.getItem(MESSAGE_NOTIFICATION_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

const incomingIds = (snapshot: MessagesSnapshot) =>
  new Set(
    snapshot.conversations.flatMap((conversation) =>
      conversation.messages
        .filter((message) => message.direction === "incoming")
        .map((message) => message.id),
    ),
  );

const notifyIncoming = async (message: PrivateMessage) => {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;
  sendNotification({
    title: `Message from ${message.username}`,
    body:
      message.body.length > 140
        ? `${message.body.slice(0, 137)}…`
        : message.body,
  });
};

const findConversation = (snapshot: MessagesSnapshot, username: string) =>
  snapshot.conversations.find(
    (conversation) =>
      conversation.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
  );

const withConversation = (
  snapshot: MessagesSnapshot,
  conversation: PrivateConversation,
): MessagesSnapshot => ({
  conversations: [
    conversation,
    ...snapshot.conversations.filter(
      (item) =>
        item.username.toLocaleLowerCase() !==
        conversation.username.toLocaleLowerCase(),
    ),
  ],
  unreadCount: snapshot.conversations
    .filter(
      (item) =>
        item.username.toLocaleLowerCase() !==
        conversation.username.toLocaleLowerCase(),
    )
    .reduce(
      (total, item) => total + item.unreadCount,
      conversation.unreadCount,
    ),
  updatedAtMs: Date.now(),
});

export function usePrivateMessages() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<MessagesSnapshot>(() =>
    native ? emptySnapshot() : previewSnapshot(),
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(
    readNotificationPreference,
  );
  const notificationPreference = useRef(notificationsEnabled);
  const knownIncoming = useRef<Set<string>>(new Set());

  useEffect(() => {
    notificationPreference.current = notificationsEnabled;
  }, [notificationsEnabled]);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<MessagesSnapshot>("forever://messages", (event) => {
      if (!mounted) return;
      const next = event.payload;
      const nextIds = incomingIds(next);
      if (notificationPreference.current) {
        const fresh = next.conversations
          .flatMap((conversation) => conversation.messages)
          .find(
            (message) =>
              message.direction === "incoming" &&
              !knownIncoming.current.has(message.id),
          );
        if (fresh) void notifyIncoming(fresh);
      }
      knownIncoming.current = nextIds;
      setSnapshot(next);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });

    void invoke<MessagesSnapshot>("messages_snapshot")
      .then((next) => {
        if (!mounted) return;
        knownIncoming.current = incomingIds(next);
        setSnapshot(next);
      })
      .catch((cause) => {
        if (mounted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [native]);

  const invokeSnapshot = useCallback(
    async (command: string, args: Record<string, unknown>) => {
      setError(null);
      try {
        const next = await invoke<MessagesSnapshot>(command, args);
        setSnapshot(next);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [],
  );

  const invokeAction = useCallback(
    async (command: string, args: Record<string, unknown>) => {
      setError(null);
      try {
        await invoke(command, args);
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [],
  );

  const send = useCallback(
    async (rawUsername: string, rawMessage: string) => {
      const username = rawUsername.trim();
      const body = rawMessage.trim();
      if (!username || !body) return;
      if (native) {
        await invokeAction("messages_send", { username, message: body });
        return;
      }
      const sentAtMs = Date.now();
      const outgoing: PrivateMessage = {
        id: `preview-${sentAtMs}`,
        serverId: null,
        username,
        body,
        direction: "outgoing",
        sentAtMs,
        unread: false,
        delivery: "sent",
        error: null,
      };
      setSnapshot((current) => {
        const existing = findConversation(current, username);
        return withConversation(current, {
          username,
          messages: [...(existing?.messages ?? []), outgoing],
          unreadCount: existing?.unreadCount ?? 0,
          updatedAtMs: sentAtMs,
        });
      });
    },
    [invokeAction, native],
  );

  const retry = useCallback(
    async (id: string) => {
      if (native) {
        await invokeAction("messages_retry", { id });
        return;
      }
      setSnapshot((current) => ({
        ...current,
        updatedAtMs: Date.now(),
        conversations: current.conversations.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === id
              ? { ...message, delivery: "sent" as const, error: null }
              : message,
          ),
        })),
      }));
    },
    [invokeAction, native],
  );

  const openConversation = useCallback(
    async (rawUsername: string) => {
      const username = rawUsername.trim();
      if (!username) return;
      if (native) {
        await invokeSnapshot("messages_open", { username });
        return;
      }
      setSnapshot((current) => {
        if (findConversation(current, username)) return current;
        return withConversation(current, {
          username,
          messages: [],
          unreadCount: 0,
          updatedAtMs: Date.now(),
        });
      });
    },
    [invokeSnapshot, native],
  );

  const updateConversation = useCallback(
    async (
      command: "messages_mark_read" | "messages_mark_unread" | "messages_clear" | "messages_remove",
      username: string,
    ) => {
      if (native) {
        await invokeSnapshot(command, { username });
        return;
      }
      setSnapshot((current) => {
        if (command === "messages_remove") {
          const conversations = current.conversations.filter(
            (conversation) =>
              conversation.username.toLocaleLowerCase() !==
              username.toLocaleLowerCase(),
          );
          return {
            conversations,
            unreadCount: conversations.reduce(
              (total, conversation) => total + conversation.unreadCount,
              0,
            ),
            updatedAtMs: Date.now(),
          };
        }
        const conversations = current.conversations.map((conversation) => {
          if (
            conversation.username.toLocaleLowerCase() !==
            username.toLocaleLowerCase()
          ) {
            return conversation;
          }
          if (command === "messages_clear") {
            return {
              ...conversation,
              messages: [],
              unreadCount: 0,
              updatedAtMs: Date.now(),
            };
          }
          const unread = command === "messages_mark_unread";
          return {
            ...conversation,
            unreadCount: unread ? 1 : 0,
            messages: conversation.messages.map((message, index, messages) => ({
              ...message,
              unread: unread ? index === messages.length - 1 : false,
            })),
          };
        });
        return {
          ...current,
          conversations,
          unreadCount: conversations.reduce(
            (total, conversation) => total + conversation.unreadCount,
            0,
          ),
          updatedAtMs: Date.now(),
        };
      });
    },
    [invokeSnapshot, native],
  );

  const setNotificationsEnabled = useCallback(
    (enabled: boolean) => {
      setNotificationsEnabledState(enabled);
      try {
        window.localStorage.setItem(
          MESSAGE_NOTIFICATION_STORAGE_KEY,
          String(enabled),
        );
      } catch {
        // The in-memory preference remains usable when storage is unavailable.
      }
      if (native && enabled) void requestPermission();
    },
    [native],
  );

  const conversationByUsername = useMemo(() => {
    const byUsername = new Map<string, PrivateConversation>();
    snapshot.conversations.forEach((conversation) =>
      byUsername.set(conversation.username.toLocaleLowerCase(), conversation),
    );
    return (username: string) => byUsername.get(username.toLocaleLowerCase()) ?? null;
  }, [snapshot.conversations]);

  return useMemo(
    () => ({
      snapshot,
      ready,
      error,
      notificationsEnabled,
      clearError: () => setError(null),
      send,
      retry,
      openConversation,
      markRead: (username: string) =>
        updateConversation("messages_mark_read", username),
      markUnread: (username: string) =>
        updateConversation("messages_mark_unread", username),
      clearConversation: (username: string) =>
        updateConversation("messages_clear", username),
      removeConversation: (username: string) =>
        updateConversation("messages_remove", username),
      setNotificationsEnabled,
      conversationByUsername,
    }),
    [
      conversationByUsername,
      error,
      notificationsEnabled,
      openConversation,
      ready,
      retry,
      send,
      setNotificationsEnabled,
      snapshot,
      updateConversation,
    ],
  );
}
