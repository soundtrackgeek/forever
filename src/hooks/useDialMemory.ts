import { getSettingsState, patchSettings, type DialMemory } from "../settings";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlbumSearchContext } from "../types";
import type { AlbumFilter } from "../components/AlbumSearchWorkspace";
import type { AlbumResultView, SearchFilter, SearchSort } from "../components/SearchWorkspace";
import { normalizeAdvancedFilters, sortLabels, type AdvancedSearchFilters } from "../utils/searchResults";
import type { SearchMode } from "../components/SearchModeSwitch";
import type { ResultScrollMemory } from "../components/VirtualResultList";

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
  advancedFilters: AdvancedSearchFilters;
  searchLayout: "list" | "grid";
  albumFilter: AlbumFilter;
  createdAtMs: number;
};

export type ClosedDialSession = Pick<DialSession, "mode" | "query"> & {
  closedAtMs: number;
};

type NewSession = Partial<Pick<DialSession, "mode" | "query" | "pinned" | "albumContext" | "albumResultView" | "searchFilter" | "searchSort" | "advancedFilters" | "searchLayout" | "albumFilter">>;

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
  searchFilter: next.searchFilter === "lossless" || next.searchFilter === "compressed" ? next.searchFilter : "all",
  searchSort: next.searchSort && Object.prototype.hasOwnProperty.call(sortLabels, next.searchSort) ? next.searchSort : "best",
  advancedFilters: normalizeAdvancedFilters(next.advancedFilters),
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

function queueDialChange(change: (saved: DialMemory) => DialMemory) {
  void patchSettings((settings) => {
    const next = change(settings.dialMemory);
    return JSON.stringify(next) === JSON.stringify(settings.dialMemory) ? {} : { dialMemory: next };
  }).catch(() => {});
}
function persistChangedPreset(id: string, value: DialSession | undefined) {
  queueDialChange((saved) => {
    const pinned = saved.pinned.filter((p) => p.id !== id);
    if (value?.pinned && value.query.trim()) {
      const { mode, query, searchFilter, searchSort, advancedFilters, searchLayout, albumFilter } = value;
      const preset = { id, mode, query, searchFilter, searchSort, advancedFilters, searchLayout, albumFilter };
      const previous = saved.pinned.findIndex((p) => p.id === id);
      pinned.splice(previous < 0 ? pinned.length : previous, 0, preset);
    }
    return { ...saved, pinned };
  });
}

const load = (): { sessions: DialSession[]; recent: ClosedDialSession[] } => {
  if (!isTauri() && !getSettingsState().settings.dialMemory.pinned.length) return { sessions: previewSessions(), recent: getSettingsState().settings.dialMemory.recent };
  try {
    const parsed = getSettingsState().settings.dialMemory;
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
  const [resultScrollMemory] = useState<ResultScrollMemory>(() => new Map());
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
    for (const key of resultScrollMemory.keys()) {
      if (!sessions.some((item) => key.startsWith(`${item.id}:`))) resultScrollMemory.delete(key);
    }
  }, [sessions, resultScrollMemory]);

  // Restores change saved presets without replacing live network results or selection.
  useEffect(() => {
    const restored = () => {
      const saved = getSettingsState().settings.dialMemory;
      const ids = new Set(saved.pinned.map((p) => p.id));
      const updated = sessionsRef.current.map((p) => ({ ...p, pinned: ids.has(p.id) }));
      sessionsRef.current = updated;
      setSessions(updated);
      setRecent(saved.recent);
    };
    window.addEventListener("forever-settings-restored", restored);
    return () => window.removeEventListener("forever-settings-restored", restored);
  }, []);

  const active = sessions.find((item) => item.id === activeId) ?? sessions[0];

  const update = useCallback((id: string, patch: Partial<Omit<DialSession, "id" | "createdAtMs">>) => {
    const next = sessionsRef.current.map((item) => item.id === id ? { ...item, ...patch } : item);
    sessionsRef.current = next;
    setSessions(next);
    persistChangedPreset(id, next.find((item) => item.id === id));
  }, []);

  const create = useCallback((next: NewSession = {}) => {
    if (sessionsRef.current.length >= DIAL_SESSION_LIMIT) return null;
    const created = session(next);
    const updated = [...sessionsRef.current, created];
    sessionsRef.current = updated;
    setSessions(updated);
    setActiveId(created.id);
    if (created.pinned) persistChangedPreset(created.id, created);
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
    sessionsRef.current = next;
    setSessions(next);
    persistChangedPreset(id, undefined);
    if (removed.query.trim()) {
      const entry = { mode: removed.mode, query: removed.query.trim(), closedAtMs: Date.now() };
      setRecent((items) => [entry, ...items.filter((item) => item.mode !== removed.mode || item.query.toLocaleLowerCase() !== removed.query.trim().toLocaleLowerCase())].slice(0, 8));
      queueDialChange((saved) => ({ ...saved, recent: [entry, ...saved.recent.filter((p) => p.mode !== entry.mode || p.query.toLocaleLowerCase() !== entry.query.toLocaleLowerCase())].slice(0, 8) }));
    }
    if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)].id);
    return removed;
  }, [activeId]);

  const reopen = useCallback((item: ClosedDialSession) => {
    const id = create({ mode: item.mode, query: item.query });
    if (id) {
      setRecent((items) => items.filter((candidate) => candidate !== item));
      queueDialChange((saved) => ({ ...saved, recent: saved.recent.filter((p) => p.mode !== item.mode || p.query !== item.query) }));
    }
    return id;
  }, [create]);

  const duplicate = useCallback((id: string) => {
    const source = sessionsRef.current.find((item) => item.id === id);
    return source ? create({
      mode: source.mode,
      query: source.query,
      searchFilter: source.searchFilter,
      searchSort: source.searchSort,
      advancedFilters: source.advancedFilters,
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
    resultScrollMemory,
    update,
    create,
    select,
    close,
    reopen,
    duplicate,
    cycle,
  };
}
