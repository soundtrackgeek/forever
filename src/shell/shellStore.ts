import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { createSelectorStore, selectSnapshot } from "./selectorStore";
import type { ShellModel } from "./useShellController";

export type ShellStore = ReturnType<typeof createSelectorStore<ShellModel>>;
export const ShellContext = createContext<ShellStore | null>(null);

export function useShell<S>(select: (state: ShellModel) => S) {
  const store = useContext(ShellContext);
  if (!store) throw new Error("Workspace must be inside ShellProvider");
  const getSelection = useMemo(
    () => selectSnapshot(store.getSnapshot, select),
    [store, select],
  );
  return useSyncExternalStore(store.subscribe, getSelection);
}
