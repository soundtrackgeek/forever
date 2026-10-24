import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDesktopExit } from "./useDesktopExit";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
let events: Record<string, (event: { payload: string }) => void>;
let requested: boolean;
const prepare = vi.fn();
const cancel = vi.fn();
beforeEach(() => {
  events = {}; requested = false;
  invoke.mockReset().mockImplementation(async (command) => {
    if (command === "desktop_quit_requested") return requested;
    if (command === "desktop_ack_quit_request") requested = false;
  });
  listen.mockReset().mockImplementation(async (name, callback) => { events[name] = callback; return vi.fn(); });
  prepare.mockReset().mockResolvedValue(undefined); cancel.mockReset().mockResolvedValue(undefined);
});
async function requestQuit() {
  await act(async () => { requested = true; events["forever://quit-requested"]({ payload: "" }); });
}
async function mount(activeCount: number) {
  const hook = renderHook(({ count }) => useDesktopExit({ native: true, activeCount: count, prepare, cancel }), { initialProps: { count: activeCount } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("desktop_quit_requested"));
  return hook;
}

it("consumes a startup Quit only after listeners exist and flushes even an idle queue", async () => {
  requested = true;
  await mount(0);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("desktop_exit"));
  expect(prepare).toHaveBeenCalledWith("pauseNow");
  expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[invoke.mock.invocationCallOrder.length - 1]);
});

it("uses the current active count, keeps running on cancel, and requires confirmation again", async () => {
  const { result, rerender } = await mount(0);
  rerender({ count: 2 });
  await requestQuit();
  expect(result.current.open).toBe(true); expect(prepare).not.toHaveBeenCalled();
  act(() => result.current.keepRunning());
  expect(result.current.open).toBe(false);
  await requestQuit(); expect(result.current.open).toBe(true);
  await act(() => result.current.pauseAndExit());
  expect(prepare).toHaveBeenCalledOnce(); expect(invoke).toHaveBeenCalledWith("desktop_exit");
});

it("keeps the window running and preserves a save error across cancellation, then retries", async () => {
  prepare.mockRejectedValueOnce(new Error("Disk full"));
  const { result } = await mount(0);
  await requestQuit();
  expect(result.current.open).toBe(true); expect(result.current.error).toContain("Disk full");
  expect(cancel).toHaveBeenCalledOnce(); expect(invoke).not.toHaveBeenCalledWith("desktop_exit");
  await act(() => result.current.pauseAndExit());
  expect(invoke).toHaveBeenCalledWith("desktop_exit");
});

it("does not run overlapping saves or dismiss a preparation in progress", async () => {
  let finish!: () => void;
  prepare.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { result } = await mount(1);
  await requestQuit();
  let pending!: Promise<void>;
  act(() => { pending = result.current.pauseAndExit(); });
  await requestQuit(); act(() => result.current.keepRunning());
  expect(result.current.open).toBe(true); expect(result.current.preparing).toBe(true);
  expect(prepare).toHaveBeenCalledOnce();
  await act(async () => { finish(); await pending; });
});

it("handles native exit failure and removes listeners, including late registration", async () => {
  const off = vi.fn();
  let register!: (off: () => void) => void;
  listen.mockImplementationOnce(() => new Promise((resolve) => { register = resolve; }));
  const hook = renderHook(() => useDesktopExit({ native: true, activeCount: 0, prepare, cancel }));
  hook.unmount();
  await act(async () => { register(off); });
  expect(off).toHaveBeenCalledOnce(); expect(invoke).not.toHaveBeenCalled();
  const { result } = await mount(0);
  invoke.mockImplementation(async (command) => {
    if (command === "desktop_quit_requested") return true;
    if (command === "desktop_exit") throw new Error("Could not flush queue");
  });
  await requestQuit();
  expect(result.current.error).toContain("Could not flush queue");
  expect(cancel).toHaveBeenCalledOnce();
});


it("does not acknowledge a request whose read completes after unmount", async () => {
  let resolve!: (requested: boolean) => void;
  invoke.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
  const hook = renderHook(() => useDesktopExit({ native: true, activeCount: 0, prepare, cancel }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("desktop_quit_requested"));
  hook.unmount();
  await act(async () => { resolve(true); });
  expect(invoke).not.toHaveBeenCalledWith("desktop_ack_quit_request");
  expect(prepare).not.toHaveBeenCalled();
});
