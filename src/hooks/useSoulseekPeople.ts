import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PeopleSnapshot, PersonProfile } from "../types";

const previewNow = Date.now();

const previewProfiles: PersonProfile[] = [
  {
    username: "audiophile92",
    status: "online",
    profileState: "ready",
    countryCode: "NL",
    description:
      "Field recordings, patient electronics, and pressings that still carry a little room noise. Please browse before messaging.",
    pictureDataUrl: null,
    averageSpeed: 8_200_000,
    uploadCount: 18_402,
    sharedFileCount: 23_941,
    sharedDirectoryCount: 1_284,
    uploadSlots: 3,
    queueSize: 1,
    slotsFree: true,
    uploadPermission: 1,
    likes: ["ambient", "electroacoustic", "dub techno", "field recordings"],
    hates: ["transcodes", "incomplete tags"],
    privileged: true,
    favorite: true,
    blocked: false,
    error: null,
    lastSeenAtMs: previewNow,
    lastInteractionAtMs: previewNow - 48_000,
    updatedAtMs: previewNow,
  },
  {
    username: "vinyljunkie",
    status: "away",
    profileState: "ready",
    countryCode: "DE",
    description: "Needledrops, krautrock, and sleeves with stories. Uploads stay open overnight.",
    pictureDataUrl: null,
    averageSpeed: 6_800_000,
    uploadCount: 9_142,
    sharedFileCount: 14_603,
    sharedDirectoryCount: 802,
    uploadSlots: 2,
    queueSize: 4,
    slotsFree: false,
    uploadPermission: 1,
    likes: ["krautrock", "kosmische", "ECM", "vinyl rips"],
    hates: ["loudness war"],
    privileged: false,
    favorite: true,
    blocked: false,
    error: null,
    lastSeenAtMs: previewNow - 180_000,
    lastInteractionAtMs: previewNow - 3_600_000,
    updatedAtMs: previewNow,
  },
  {
    username: "soulseeker7",
    status: "online",
    profileState: "ready",
    countryCode: "US",
    description: "Sharing independent radio sessions and hard-to-find deluxe editions.",
    pictureDataUrl: null,
    averageSpeed: 5_100_000,
    uploadCount: 4_331,
    sharedFileCount: 8_210,
    sharedDirectoryCount: 436,
    uploadSlots: 2,
    queueSize: 0,
    slotsFree: true,
    uploadPermission: 1,
    likes: ["college radio", "post-rock", "shoegaze"],
    hates: [],
    privileged: false,
    favorite: false,
    blocked: false,
    error: null,
    lastSeenAtMs: previewNow,
    lastInteractionAtMs: previewNow - 86_400_000,
    updatedAtMs: previewNow,
  },
  {
    username: "deepcrate",
    status: "offline",
    profileState: "ready",
    countryCode: "GB",
    description: "Deep catalogue soul, spiritual jazz, and radio archives.",
    pictureDataUrl: null,
    averageSpeed: 3_700_000,
    uploadCount: 2_807,
    sharedFileCount: 6_994,
    sharedDirectoryCount: 391,
    uploadSlots: 1,
    queueSize: 0,
    slotsFree: false,
    uploadPermission: 1,
    likes: ["spiritual jazz", "library music", "rare groove"],
    hates: [],
    privileged: false,
    favorite: false,
    blocked: false,
    error: null,
    lastSeenAtMs: previewNow - 7_200_000,
    lastInteractionAtMs: previewNow - 172_800_000,
    updatedAtMs: previewNow,
  },
  {
    username: "resonant",
    status: "online",
    profileState: "ready",
    countryCode: "SE",
    description: "Minimal electronics, contemporary classical, and careful metadata.",
    pictureDataUrl: null,
    averageSpeed: 7_400_000,
    uploadCount: 7_540,
    sharedFileCount: 11_282,
    sharedDirectoryCount: 625,
    uploadSlots: 3,
    queueSize: 0,
    slotsFree: true,
    uploadPermission: 1,
    likes: ["minimalism", "modern composition", "IDM"],
    hates: [],
    privileged: true,
    favorite: false,
    blocked: false,
    error: null,
    lastSeenAtMs: previewNow,
    lastInteractionAtMs: previewNow - 259_200_000,
    updatedAtMs: previewNow,
  },
  {
    username: "signalpath",
    status: "online",
    profileState: "ready",
    countryCode: "CA",
    description: "Live sets and longform ambient. Folder names are part of the liner notes.",
    pictureDataUrl: null,
    averageSpeed: 4_900_000,
    uploadCount: 3_114,
    sharedFileCount: 7_018,
    sharedDirectoryCount: 340,
    uploadSlots: 1,
    queueSize: 2,
    slotsFree: false,
    uploadPermission: 1,
    likes: ["live sets", "drone", "sound art"],
    hates: [],
    privileged: false,
    favorite: false,
    blocked: false,
    error: null,
    lastSeenAtMs: previewNow,
    lastInteractionAtMs: previewNow - 432_000_000,
    updatedAtMs: previewNow,
  },
];

const snapshotFrom = (users: PersonProfile[]): PeopleSnapshot => ({
  users,
  favoriteCount: users.filter((person) => person.favorite).length,
  onlineFavoriteCount: users.filter(
    (person) => person.favorite && person.status === "online",
  ).length,
  updatedAtMs: Date.now(),
});

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function useSoulseekPeople() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<PeopleSnapshot>(() =>
    snapshotFrom(native ? [] : previewProfiles),
  );
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<PeopleSnapshot>("forever://people", (event) => {
      if (mounted) setSnapshot(event.payload);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });

    void invoke<PeopleSnapshot>("people_snapshot")
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

  const openProfile = useCallback(
    async (rawUsername: string, refresh = false) => {
      const username = rawUsername.trim();
      if (!username) throw new Error("Enter a Soulseek username.");
      setError(null);
      if (!native) {
        const existing = previewProfiles.find((person) =>
          person.username.localeCompare(username, undefined, { sensitivity: "accent" }) === 0,
        );
        const profile =
          existing ??
          ({
            ...previewProfiles[2],
            username,
            countryCode: null,
            description: "Preview profile — connect to Soulseek to request live details.",
            likes: [],
            hates: [],
            favorite: false,
            privileged: false,
          } satisfies PersonProfile);
        setSnapshot((current) =>
          snapshotFrom([
            profile,
            ...current.users.filter(
              (person) =>
                person.username.toLocaleLowerCase() !== username.toLocaleLowerCase(),
            ),
          ]),
        );
        return profile;
      }

      try {
        const profile = await invoke<PersonProfile>("people_profile", {
          username,
          refresh,
        });
        setSnapshot((current) =>
          snapshotFrom([
            profile,
            ...current.users.filter(
              (person) => person.username.toLocaleLowerCase() !== username.toLocaleLowerCase(),
            ),
          ]),
        );
        return profile;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native],
  );

  const updateBoolean = useCallback(
    async (
      command: "people_set_favorite" | "people_set_blocked",
      username: string,
      key: "favorite" | "blocked",
      value: boolean,
    ) => {
      setError(null);
      try {
        const next = native
          ? await invoke<PeopleSnapshot>(command, { username, [key]: value })
          : snapshotFrom(
              snapshot.users.map((person) =>
                person.username.toLocaleLowerCase() === username.toLocaleLowerCase()
                  ? { ...person, [key]: value }
                  : person,
              ),
            );
        setSnapshot(next);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      }
    },
    [native, snapshot.users],
  );

  const personByUsername = useMemo(() => {
    const people = new Map<string, PersonProfile>();
    snapshot.users.forEach((person) =>
      people.set(person.username.toLocaleLowerCase(), person),
    );
    return (username: string) => people.get(username.toLocaleLowerCase()) ?? null;
  }, [snapshot.users]);

  return useMemo(
    () => ({
      snapshot,
      ready,
      error,
      clearError: () => setError(null),
      openProfile,
      setFavorite: (username: string, favorite: boolean) =>
        updateBoolean("people_set_favorite", username, "favorite", favorite),
      setBlocked: (username: string, blocked: boolean) =>
        updateBoolean("people_set_blocked", username, "blocked", blocked),
      personByUsername,
    }),
    [error, openProfile, personByUsername, ready, snapshot, updateBoolean],
  );
}
