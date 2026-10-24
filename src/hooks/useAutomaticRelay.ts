import { useEffect, useRef } from "react";
import type { AlbumSearchContext, AlbumSource, FolderInspection, ReleaseAlternativeSource, SourceReliability } from "../types";
import type { SearchSessionRecord } from "./useSoulseekSearch";
import type { TransferGroup } from "../utils/transfers";
import { groupAlbumSources } from "../utils/albumSources";
import { exactMirror, reliabilityScore, sourceMemory, stalledForRecovery } from "../utils/sourceRecovery";

type Inputs = {
  enabled: boolean; minutes: number; groups: TransferGroup[];
  memory: Record<string, SourceReliability>; records: Record<string, SearchSessionRecord>;
  excluded: (username: string) => boolean;
  startSearch: (id: string, title: string, album?: Pick<AlbumSearchContext, "artist" | "title">) => Promise<unknown>;
  inspect: (source: AlbumSource) => Promise<FolderInspection>;
  switchSource: (releaseId: string, source: ReleaseAlternativeSource) => Promise<boolean>;
  closeSearch: (id: string) => Promise<unknown>;
};

// Lives above workspace routes. Search responses are only hints: full folder
// inspection and the backend's current-state check must both accept a switch.
export function useAutomaticRelay(inputs: Inputs) {
  const latest = useRef(inputs);
  useEffect(() => { latest.current = inputs; });
  useEffect(() => {
    let disposed = false;
    let running = false;
    const scanned = new Map<string, number>();
    const tick = async () => {
      const current = latest.current;
      if (running || !current.enabled || current.minutes === 0) return;
      running = true;
      try {
        const now = Date.now();
        const ids = new Set(current.groups.map((g) => g.id));
        for (const id of scanned.keys()) if (!ids.has(id)) scanned.delete(id);
        for (const group of current.groups) {
          if (disposed || !latest.current.enabled || latest.current.minutes === 0) break;
          if (!group.releaseId || !stalledForRecovery(group.transfers, current.minutes, now)) continue;
          const session = `signal-relay:${group.releaseId}`;
          const allowed = (source: ReleaseAlternativeSource) => !latest.current.excluded(source.username) && exactMirror(group.transfers, source);
          const score = (user: string) => reliabilityScore(sourceMemory(current.memory, user));
          const known = [...new Map(group.transfers.flatMap((t) => t.alternativeSources ?? []).map((s) => [`${s.username}:${s.remoteFolder}`, s])).values()]
            .filter(allowed).sort((a, b) => score(b.username) - score(a.username));
          let switched = false;
          for (const source of known.slice(0, 3)) {
            if (disposed || !latest.current.enabled || latest.current.minutes === 0) break;
            if (await current.switchSource(group.releaseId, source)) { switched = true; break; }
          }
          const record = current.records[session];
          if (!switched && record?.snapshot.state === "completed") {
            const sources = groupAlbumSources(record.results).filter((s) => !current.excluded(s.owner))
              .sort((a, b) => score(b.owner) - score(a.owner) || Number(b.slotFree) - Number(a.slotFree) || a.queueLength - b.queueLength);
            let inspections = 0;
            for (const source of sources) {
              const hint: ReleaseAlternativeSource = { username: source.owner, remoteFolder: source.folder,
                files: source.files.map((f) => ({ title: f.title, remoteFilename: f.filename ?? f.title, sizeBytes: f.sizeBytes ?? 0 })) };
              if (!allowed(hint)) continue;
              if (disposed || !latest.current.enabled || latest.current.minutes === 0 || inspections++ >= 3) break;
              try {
                const folder = await current.inspect(source);
                const checked = { ...hint, remoteFolder: folder.requestedFolder,
                  files: folder.files.map((f) => ({ title: f.filename, remoteFilename: f.remoteFilename, sizeBytes: f.sizeBytes })) };
                if (!disposed && latest.current.enabled && latest.current.minutes > 0 && allowed(checked)
                  && await current.switchSource(group.releaseId, checked)) { switched = true; break; }
              } catch { /* A non-answer remains available for manual review. */ }
            }
          }
          if (switched) { await current.closeSearch(session); scanned.delete(group.id); }
          else if (!disposed && latest.current.enabled && latest.current.minutes > 0 && (!record || record.snapshot.state !== "searching") && now - (scanned.get(group.id) ?? 0) >= 300_000) {
            scanned.set(group.id, now);
            await current.startSearch(session, group.title, group.transfers.find((t) => t.searchAlbum)?.searchAlbum ?? undefined);
          }
        }
      } catch { /* Keep failures bounded by the next timer and normal notices. */ }
      finally { running = false; }
    };
    const timer = window.setInterval(() => void tick(), 30_000);
    void tick();
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
}
