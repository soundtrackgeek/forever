import { useLayoutEffect, useState, type ReactNode } from "react";
import { createSelectorStore } from "./selectorStore";
import { ShellContext } from "./shellStore";
import { useShellController } from "./useShellController";

// Own each live listener once, above all lazy routes. Navigating never tears
// down searches, transfers, Wanted checks, connection state, or message events.
export function ShellProvider({ children }: { children: ReactNode }) {
  const model = useShellController();
  const [store] = useState(() => createSelectorStore(model));
  useLayoutEffect(() => {
    store.publish(model);
  });
  return (
    <ShellContext.Provider value={store}>{children}</ShellContext.Provider>
  );
}
