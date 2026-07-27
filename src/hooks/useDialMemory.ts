import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlbumSearchContext } from "../types";
import type { AlbumFilter } from "../components/AlbumSearchWorkspace";
import type { AlbumResultView, SearchFilter, SearchSort } from "../components/SearchWorkspace";
import type { SearchMode } from "../components/SearchModeSwitch";

const STORAGE_KEY = "forever.dial-memory.v1";
export const DIAL_SESSION_LIMIT = 8;
export const PREVIEW_DIAL_IDS = {
  night: "preview-night-geometry",
  defLeppard: "preview-def-leppard",
  bowie: "preview-bowie-demos",
  kateBush: "preview-kate-bush",
} as const;

export type DialSession = {
  id: string;
  mode: SearchMode;
  query: string;
  pinned: boolean;
  selectedResultId: string | null;
  albumContext: AlbumSearchContext | null;
  albumResultView: AlbumResultView;
  searchFilter: SearchFilter;
  searchSort: SearchSort;
  searchLayout: "list" | "grid";
  albumFilter: AlbumFilter;
  createdAtMs: number;
};

export type ClosedDialSession = Pick<DialSession, "mode" | "query"> & {
  closedAtMs: number;
};

type PersistedDialMemory = {
  pinned: Array<Pick<DialSession, "id" | "mode" | "query" | "searchFilter" | "searchSort" | "searchLayout" | "albumFilter">>;
  recent: ClosedDialSession[];
};

type NewSession = Partial<Pick<DialSession, "mode" | "query" | "pinned" | "albumContext" | "albumResultView" | "searchFilter" | "searchSort" | "searchLayout" | "albumFilter">>;

const createId = () => {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "");
  return `dial-${random ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
};

const session = (next: NewSession = {}, id = createId()): DialSession => ({
  id,
  mode: next.mode ?? "files",
  query: next.query ?? "",
  pinned: next.pinned ?? false,
  selectedResultId: null,
  albumContext: next.albumContext ?? null,
  albumResultView: next.albumResultView ?? "files",
  searchFilter: next.searchFilter ?? "all",
  searchSort: next.searchSort ?? "best",
  searchLayout: next.searchLayout ?? "list",
  albumFilter: next.albumFilter ?? "studio",
  createdAtMs: Date.now(),
});

const previewSessions = (): DialSession[] => [
  session({ mode: "files", query: "night geometry" }, PREVIEW_DIAL_IDS.night),
  session({ mode: "albums", query: "Def Leppard" }, PREVIEW_DIAL_IDS.defLeppard),
  session({ mode: "files", query: "rare Bowie demos" }, PREVIEW_DIAL_IDS.bowie),
  session({ mode: "albums", query: "Kate Bush", pinned: true }, PREVIEW_DIAL_IDS.kateBush),
];

const load = (): { sessions: DialSession[]; recent: ClosedDialSession[] } => {
  if (!isTauri()) return { sessions: previewSessions(), recent: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as PersistedDialMemory | null;
    const pinned = (parsed?.pinned ?? [])
      .filter((item) => item.id && item.query && (item.mode === "files" || item.mode === "albums"))
      .slice(0, DIAL_SESSION_LIMIT)
      .map((item) => session({ ...item, pinned: true }, item.id));
    return {
      sessions: pinned.length < DIAL_SESSION_LIMIT ? [...pinned, session()] : pinned,
      recent: (parsed?.recent ?? []).filter((item) => item.query).slice(0, 8),
    };
  } catch {
    return { sessions: [session()], recent: [] };
  }
};

export function useDialMemory() {
  const initial = useMemo(() => load(), []);
  const [sessions, setSessions] = useState(initial.sessions);
  const [recent, setRecent] = useState(initial.recent);
  const [activeId, setActiveId] = useState(initial.sessions[0].id);
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const persisted: PersistedDialMemory = {
      pinned: sessions
        .filter((item) => item.pinned && item.query.trim())
        .map(({ id, mode, query, searchFilter, searchSort, searchLayout, albumFilter }) => ({
          id, mode, query, searchFilter, searchSort, searchLayout, albumFilter,
        })),
      recent,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [recent, sessions]);

  const active = sessions.find((item) => item.id === activeId) ?? sessions[0];

  const update = useCallback((id: string, patch: Partial<Omit<DialSession, "id" | "createdAtMs">>) => {
    setSessions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const create = useCallback((next: NewSession = {}) => {
    if (sessionsRef.current.length >= DIAL_SESSION_LIMIT) return null;
    const created = session(next);
    setSessions((current) => [...current, created]);
    setActiveId(created.id);
    return created.id;
  }, []);

  const select = useCallback((id: string) => {
    if (sessionsRef.current.some((item) => item.id === id)) setActiveId(id);
  }, []);

  const close = useCallback((id: string) => {
    const current = sessionsRef.current;
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const removed = current[index];
    const remaining = current.filter((item) => item.id !== id);
    const next = remaining.length > 0 ? remaining : [session()];
    setSessions(next);
    if (removed.query.trim()) {
      setRecent((items) => [
        { mode: removed.mode, query: removed.query.trim(), closedAtMs: Date.now() },
        ...items.filter((item) => item.mode !== removed.mode || item.query.toLocaleLowerCase() !== removed.query.trim().toLocaleLowerCase()),
      ].slice(0, 8));
    }
    if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)].id);
    return removed;
  }, [activeId]);

  const reopen = useCallback((item: ClosedDialSession) => {
    const id = create({ mode: item.mode, query: item.query });
    if (id) setRecent((items) => items.filter((candidate) => candidate !== item));
    return id;
  }, [create]);

  const duplicate = useCallback((id: string) => {
    const source = sessionsRef.current.find((item) => item.id === id);
    return source ? create({
      mode: source.mode,
      query: source.query,
      searchFilter: source.searchFilter,
      searchSort: source.searchSort,
      searchLayout: source.searchLayout,
      albumFilter: source.albumFilter,
    }) : null;
  }, [create]);

  const cycle = useCallback((direction: 1 | -1) => {
    const current = sessionsRef.current;
    if (current.length < 2) return current[0]?.id ?? null;
    const index = current.findIndex((item) => item.id === activeId);
    const nextId = current[(index + direction + current.length) % current.length].id;
    setActiveId(nextId);
    return nextId;
  }, [activeId]);

  return {
    sessions,
    active,
    activeId,
    recent,
    atLimit: sessions.length >= DIAL_SESSION_LIMIT,
    update,
    create,
    select,
    close,
    reopen,
    duplicate,
    cycle,
  };
}
