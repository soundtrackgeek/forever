import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomMessage, RoomsSnapshot, SoulseekRoom } from "../types";

export const ROOM_NOTIFICATION_STORAGE_KEY =
  "forever.roomNotificationsEnabled";

const previewNow = Date.now();

const previewRooms: SoulseekRoom[] = [
  {
    name: "Lossless Listening",
    userCount: 124,
    joined: true,
    joining: false,
    autoJoin: true,
    favorite: true,
    unreadCount: 1,
    mentionCount: 1,
    lastMessageAtMs: previewNow - 38_000,
    messages: [
      {
        id: "preview-room-1",
        room: "Lossless Listening",
        username: "tape_echo",
        body: "That Japanese pressing is beautifully quiet between tracks.",
        sentAtMs: previewNow - 360_000,
        own: false,
        unread: false,
        mention: false,
      },
      {
        id: "preview-room-2",
        room: "Lossless Listening",
        username: "jtbleach",
        body: "Has anyone compared it with the 2011 remaster?",
        sentAtMs: previewNow - 210_000,
        own: true,
        unread: false,
        mention: false,
      },
      {
        id: "preview-room-3",
        room: "Lossless Listening",
        username: "aurora_flac",
        body: "@jtbleach I have both. The original has much more room to breathe.",
        sentAtMs: previewNow - 38_000,
        own: false,
        unread: true,
        mention: true,
      },
    ],
    members: [
      { username: "aurora_flac", status: 2, averageSpeed: 18_200_000, uploadCount: 4, sharedFileCount: 184_210, sharedDirectoryCount: 12_940, slotsFree: true, countryCode: "NO" },
      { username: "tape_echo", status: 2, averageSpeed: 7_800_000, uploadCount: 2, sharedFileCount: 62_441, sharedDirectoryCount: 5_230, slotsFree: false, countryCode: "GB" },
      { username: "midnightpress", status: 1, averageSpeed: 31_000_000, uploadCount: 8, sharedFileCount: 344_012, sharedDirectoryCount: 21_110, slotsFree: true, countryCode: "DE" },
      { username: "blue_note_75", status: 2, averageSpeed: 12_400_000, uploadCount: 3, sharedFileCount: 98_770, sharedDirectoryCount: 8_042, slotsFree: true, countryCode: "US" },
      { username: "slowburn", status: 0, averageSpeed: 2_100_000, uploadCount: 1, sharedFileCount: 12_440, sharedDirectoryCount: 920, slotsFree: false, countryCode: "SE" },
    ],
  },
  {
    name: "Ambient / Drone",
    userCount: 61,
    joined: true,
    joining: false,
    autoJoin: true,
    favorite: false,
    unreadCount: 2,
    mentionCount: 0,
    lastMessageAtMs: previewNow - 92_000,
    messages: [
      { id: "preview-ambient-1", room: "Ambient / Drone", username: "slow_air", body: "The full broadcast archive just surfaced in FLAC.", sentAtMs: previewNow - 142_000, own: false, unread: true, mention: false },
      { id: "preview-ambient-2", room: "Ambient / Drone", username: "cirrus", body: "Listening now — wonderful tape texture.", sentAtMs: previewNow - 92_000, own: false, unread: true, mention: false },
    ],
    members: [
      { username: "slow_air", status: 2, averageSpeed: 9_600_000, uploadCount: 2, sharedFileCount: 45_220, sharedDirectoryCount: 3_182, slotsFree: true, countryCode: "FI" },
      { username: "cirrus", status: 2, averageSpeed: 5_200_000, uploadCount: 1, sharedFileCount: 23_901, sharedDirectoryCount: 1_884, slotsFree: false, countryCode: "CA" },
    ],
  },
  ...[
    ["Post-Punk", 203, true],
    ["Jazz Vinyl", 188, true],
    ["Electronic 80s", 156, false],
    ["Rare Live Recordings", 92, false],
    ["Soundtracks", 78, false],
    ["Nordic Music", 44, false],
  ].map(([name, userCount, favorite]) => ({
    name: String(name),
    userCount: Number(userCount),
    joined: false,
    joining: false,
    autoJoin: false,
    favorite: Boolean(favorite),
    unreadCount: 0,
    mentionCount: 0,
    lastMessageAtMs: null,
    messages: [],
    members: [],
  })),
];

const snapshotFromRooms = (rooms: SoulseekRoom[]): RoomsSnapshot => ({
  rooms,
  connected: true,
  unreadCount: rooms.reduce((total, room) => total + room.unreadCount, 0),
  mentionCount: rooms.reduce((total, room) => total + room.mentionCount, 0),
  updatedAtMs: Date.now(),
});

const emptySnapshot = (): RoomsSnapshot => ({
  rooms: [],
  connected: false,
  unreadCount: 0,
  mentionCount: 0,
  updatedAtMs: Date.now(),
});

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const readNotificationPreference = () => {
  try {
    return window.localStorage.getItem(ROOM_NOTIFICATION_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

const messageIds = (snapshot: RoomsSnapshot) =>
  new Set(snapshot.rooms.flatMap((room) => room.messages.map((message) => message.id)));

const notifyRoomMessage = async (message: RoomMessage) => {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;
  sendNotification({
    title: message.mention ? `Mention in ${message.room}` : message.room,
    body: `${message.username}: ${message.body.length > 120 ? `${message.body.slice(0, 117)}…` : message.body}`,
  });
};

export function useSoulseekRooms() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<RoomsSnapshot>(() =>
    native ? emptySnapshot() : snapshotFromRooms(previewRooms),
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(
    readNotificationPreference,
  );
  const knownMessages = useRef<Set<string>>(new Set());
  const notificationPreference = useRef(notificationsEnabled);

  useEffect(() => {
    notificationPreference.current = notificationsEnabled;
  }, [notificationsEnabled]);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<RoomsSnapshot>("forever://rooms", (event) => {
      if (!mounted) return;
      const next = event.payload;
      if (notificationPreference.current) {
        for (const room of next.rooms) {
          const fresh = room.messages.find(
            (message) =>
              !message.own &&
              !knownMessages.current.has(message.id) &&
              (message.mention || room.favorite),
          );
          if (fresh) void notifyRoomMessage(fresh);
        }
      }
      knownMessages.current = messageIds(next);
      setSnapshot(next);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });

    void invoke<RoomsSnapshot>("rooms_snapshot")
      .then((next) => {
        if (!mounted) return;
        knownMessages.current = messageIds(next);
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
    async (command: string, args: Record<string, unknown> = {}) => {
      setError(null);
      try {
        const next = await invoke<RoomsSnapshot>(command, args);
        setSnapshot(next);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [],
  );

  const updatePreviewRoom = useCallback(
    (name: string, update: (room: SoulseekRoom) => SoulseekRoom) => {
      setSnapshot((current) =>
        snapshotFromRooms(
          current.rooms.map((room) =>
            room.name.toLocaleLowerCase() === name.toLocaleLowerCase()
              ? update(room)
              : room,
          ),
        ),
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (native) return invokeSnapshot("rooms_refresh");
    setSnapshot((current) => ({ ...current, updatedAtMs: Date.now() }));
    return snapshot;
  }, [invokeSnapshot, native, snapshot]);

  const join = useCallback(async (roomName: string) => {
    const room = roomName.trim();
    if (native) return invokeSnapshot("rooms_join", { room });
    setSnapshot((current) => {
      const existing = current.rooms.find(
        (item) => item.name.toLocaleLowerCase() === room.toLocaleLowerCase(),
      );
      const joined = existing
        ? current.rooms.map((item) =>
            item === existing ? { ...item, joined: true, autoJoin: true } : item,
          )
        : [
            { name: room, userCount: 1, joined: true, joining: false, autoJoin: true, favorite: false, unreadCount: 0, mentionCount: 0, lastMessageAtMs: null, messages: [], members: [] },
            ...current.rooms,
          ];
      return snapshotFromRooms(joined);
    });
    return snapshot;
  }, [invokeSnapshot, native, snapshot]);

  const leave = useCallback(async (room: string) => {
    if (native) return invokeSnapshot("rooms_leave", { room });
    updatePreviewRoom(room, (item) => ({ ...item, joined: false, autoJoin: false, members: [] }));
    return snapshot;
  }, [invokeSnapshot, native, snapshot, updatePreviewRoom]);

  const send = useCallback(async (room: string, message: string) => {
    if (native) return invokeSnapshot("rooms_send", { room, message });
    updatePreviewRoom(room, (item) => ({
      ...item,
      lastMessageAtMs: Date.now(),
      messages: [...item.messages, { id: `preview-own-${Date.now()}`, room, username: "jtbleach", body: message.trim(), sentAtMs: Date.now(), own: true, unread: false, mention: false }],
    }));
    return snapshot;
  }, [invokeSnapshot, native, snapshot, updatePreviewRoom]);

  const markRead = useCallback(async (room: string) => {
    if (native) return invokeSnapshot("rooms_mark_read", { room });
    updatePreviewRoom(room, (item) => ({
      ...item,
      unreadCount: 0,
      mentionCount: 0,
      messages: item.messages.map((message) => ({ ...message, unread: false, mention: false })),
    }));
    return snapshot;
  }, [invokeSnapshot, native, snapshot, updatePreviewRoom]);

  const setFavorite = useCallback(async (room: string, favorite: boolean) => {
    if (native) return invokeSnapshot("rooms_set_favorite", { room, favorite });
    updatePreviewRoom(room, (item) => ({ ...item, favorite }));
    return snapshot;
  }, [invokeSnapshot, native, snapshot, updatePreviewRoom]);

  const setNotificationsEnabled = useCallback((enabled: boolean) => {
    setNotificationsEnabledState(enabled);
    try {
      window.localStorage.setItem(ROOM_NOTIFICATION_STORAGE_KEY, String(enabled));
    } catch {
      // Preference remains active for this session when storage is unavailable.
    }
  }, []);

  return useMemo(() => ({
    snapshot,
    ready,
    error,
    notificationsEnabled,
    refresh,
    join,
    leave,
    send,
    markRead,
    setFavorite,
    setNotificationsEnabled,
    clearError: () => setError(null),
  }), [error, join, leave, markRead, notificationsEnabled, ready, refresh, send, setFavorite, setNotificationsEnabled, snapshot]);
}
