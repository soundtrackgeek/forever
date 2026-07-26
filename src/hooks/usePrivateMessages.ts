import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MessagesSnapshot, PrivateConversation, PrivateMessage } from "../types";

const now = Date.now();
const previewConversation: PrivateConversation = {
  username: "audiophile92",
  unreadCount: 1,
  updatedAtMs: now - 45_000,
  messages: [
    {
      id: "preview-incoming",
      serverId: 1,
      username: "audiophile92",
      body: "Hi — I found that late-night radio session you were looking for.",
      direction: "incoming",
      sentAtMs: now - 45_000,
      unread: true,
    },
  ],
};

const emptySnapshot = (): MessagesSnapshot => ({
  conversations: [],
  unreadCount: 0,
  updatedAtMs: Date.now(),
});

const previewSnapshot = (): MessagesSnapshot => ({
  conversations: [previewConversation],
  unreadCount: previewConversation.unreadCount,
  updatedAtMs: now,
});

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function usePrivateMessages() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<MessagesSnapshot>(() =>
    native ? emptySnapshot() : previewSnapshot(),
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<MessagesSnapshot>("forever://messages", (event) => {
      if (mounted) setSnapshot(event.payload);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });

    void invoke<MessagesSnapshot>("messages_snapshot")
      .then((next) => {
        if (mounted) setSnapshot(next);
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

  const send = useCallback(
    async (rawUsername: string, rawMessage: string) => {
      const username = rawUsername.trim();
      const message = rawMessage.trim();
      if (!username || !message) return;
      setError(null);
      try {
        if (native) {
          await invoke("messages_send", { username, message });
          return;
        }
        const sentAtMs = Date.now();
        const outgoing: PrivateMessage = {
          id: `preview-${sentAtMs}`,
          serverId: null,
          username,
          body: message,
          direction: "outgoing",
          sentAtMs,
          unread: false,
        };
        setSnapshot((current) => {
          const existing = current.conversations.find((conversation) =>
            conversation.username.localeCompare(username, undefined, { sensitivity: "accent" }) === 0,
          );
          const conversation: PrivateConversation = existing
            ? { ...existing, messages: [...existing.messages, outgoing], updatedAtMs: sentAtMs }
            : { username, messages: [outgoing], unreadCount: 0, updatedAtMs: sentAtMs };
          return {
            conversations: [
              conversation,
              ...current.conversations.filter((item) => item !== existing),
            ],
            unreadCount: current.unreadCount,
            updatedAtMs: sentAtMs,
          };
        });
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native],
  );

  const markRead = useCallback(
    async (username: string) => {
      try {
        if (native) {
          const next = await invoke<MessagesSnapshot>("messages_mark_read", { username });
          setSnapshot(next);
          return;
        }
        setSnapshot((current) => ({
          ...current,
          unreadCount: current.conversations
            .filter(
              (conversation) =>
                conversation.username.toLocaleLowerCase() !== username.toLocaleLowerCase(),
            )
            .reduce((total, conversation) => total + conversation.unreadCount, 0),
          conversations: current.conversations.map((conversation) =>
            conversation.username.toLocaleLowerCase() === username.toLocaleLowerCase()
              ? {
                  ...conversation,
                  unreadCount: 0,
                  messages: conversation.messages.map((message) => ({ ...message, unread: false })),
                }
              : conversation,
          ),
        }));
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native],
  );

  const conversations = useMemo(() => {
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
      clearError: () => setError(null),
      send,
      markRead,
      conversationByUsername: conversations,
    }),
    [conversations, error, markRead, ready, send, snapshot],
  );
}
