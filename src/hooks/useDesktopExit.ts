import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  native: boolean;
  activeCount: number;
  prepare: (mode: "pauseNow") => Promise<unknown>;
  cancel: () => Promise<unknown>;
};

export function useDesktopExit(options: Options) {
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(options);
  const busy = useRef(false);
  const dialogOpen = useRef(false);
  useEffect(() => { current.current = options; });

  const pauseAndExit = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPreparing(true); setError(null);
    try {
      await current.current.prepare("pauseNow");
      await invoke("desktop_exit");
    } catch (cause) {
      // Preserve the original failure even if cancellation succeeds or also fails.
      await current.current.cancel().catch(() => undefined);
      setError(String(cause)); setOpen(true); dialogOpen.current = true;
    } finally {
      busy.current = false; setPreparing(false);
    }
  }, []);

  const keepRunning = useCallback(() => {
    if (busy.current) return;
    setOpen(false); setError(null); dialogOpen.current = false;
  }, []);

  useEffect(() => {
    if (!options.native) return;
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const takeRequest = async () => {
      if (disposed) return;
      const requested = await invoke<boolean>("desktop_quit_requested");
      if (!requested || disposed) return;
      // A read completing after unmount must not discard the native request.
      void invoke("desktop_ack_quit_request").catch(report);
      if (busy.current || dialogOpen.current) return;
      if (current.current.activeCount > 0) {
        dialogOpen.current = true; setOpen(true);
      } else {
        await pauseAndExit();
      }
    };
    const report = (cause: unknown) => {
      if (!disposed) { setError(String(cause)); setOpen(true); dialogOpen.current = true; }
    };
    void (async () => {
      const off = await listen("forever://quit-requested", () => { void takeRequest().catch(report); });
      if (disposed) { off(); return; }
      cleanup.push(off);
      const offError = await listen<string>("forever://desktop-error", (event) => report(event.payload));
      if (disposed) { offError(); return; }
      cleanup.push(offError);
      await takeRequest(); // A native request may predate the WebView listener.
    })().catch(report);
    return () => { disposed = true; cleanup.forEach((off) => off()); };
  }, [options.native, pauseAndExit]);

  return { open, preparing, error, pauseAndExit, keepRunning };
}
