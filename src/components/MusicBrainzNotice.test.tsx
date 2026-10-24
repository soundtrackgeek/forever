import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MusicBrainzNotice } from "./MusicBrainzNotice";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), isTauri: vi.fn(), dispose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.listen.mockResolvedValue(mocks.dispose);
  mocks.invoke.mockResolvedValue({ revision: 0, retryAtMs: null, cacheWarning: null });
});
afterEach(() => vi.useRealTimers());

it("subscribes before the snapshot, ignores older snapshots, and counts down the cooldown", async () => {
  let snapshot!: (value: unknown) => void;
  mocks.invoke.mockImplementation(() => new Promise((resolve) => { snapshot = resolve; }));
  render(<MusicBrainzNotice />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("musicbrainz_status"));
  expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  act(() => mocks.listen.mock.calls[0][1]({ payload: { revision: 2, retryAtMs: 13000, cacheWarning: null } }));
  await act(async () => snapshot({ revision: 1, retryAtMs: null, cacheWarning: null }));
  expect(screen.getByRole("status")).toHaveTextContent("Waiting 3 s");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status")).toHaveTextContent("Waiting 2 s");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows cache fallback and dismisses its notice without hiding a cooldown", async () => {
  mocks.invoke.mockResolvedValue({ revision: 1, retryAtMs: Date.now() + 60000, cacheWarning: "Disk unavailable; using a session cache." });
  const { unmount } = render(<MusicBrainzNotice />);
  await screen.findByText("Disk unavailable; using a session cache.");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss cache notice" }));
  expect(screen.queryByText("Disk unavailable; using a session cache.")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("MusicBrainz is busy");
  unmount();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("disposes a listener that arrives after unmount without fetching a snapshot", async () => {
  let subscribe!: (value: () => void) => void;
  mocks.listen.mockImplementation(() => new Promise((resolve) => { subscribe = resolve; }));
  const { unmount } = render(<MusicBrainzNotice />);
  unmount();
  await act(async () => subscribe(mocks.dispose));
  expect(mocks.dispose).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("does not contact native APIs in browser preview", () => {
  mocks.isTauri.mockReturnValue(false);
  render(<MusicBrainzNotice />);
  expect(mocks.listen).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
