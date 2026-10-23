import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { matchingCommand as invoke } from "../utils/matchingClient";
import { useMatchingRequest } from "./useMatching";
vi.mock("../utils/matchingClient", () => ({ matchingCommand: vi.fn() }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });
const deferred = () => { let resolve!: (v: string) => void; const promise = new Promise<string>((r) => { resolve = r; }); return { promise, resolve }; };

it("discards stale replies and clears recommendations as inputs change", async () => {
  const first = deferred(); const second = deferred(); const third = deferred();
  vi.mocked(invoke).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  const { result, rerender } = renderHook(({ request }) => useMatchingRequest<string>("rank_album_sources", request), { initialProps: { request: '{"album":"first"}' } });
  rerender({ request: '{"album":"second"}' });
  await act(async () => second.resolve("second ranking"));
  expect(result.current.data).toBe("second ranking");
  await act(async () => first.resolve("stale first ranking"));
  expect(result.current.data).toBe("second ranking");
  rerender({ request: '{"album":"second","preference":"mp3Only"}' });
  expect(result.current.data).toBeNull(); expect(result.current.pending).toBe(true);
  await act(async () => third.resolve("new preference ranking"));
  expect(result.current.data).toBe("new preference ranking");
});

it("shows command failures without a fallback recommendation", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("matching failed"));
  const { result, rerender } = renderHook(({ request }: { request: string | null }) => useMatchingRequest("rank_album_sources", request), { initialProps: { request: "{}" as string | null } });
  await waitFor(() => expect(result.current.error).toContain("matching failed"));
  expect(result.current.pending).toBe(false); expect(result.current.data).toBeNull();
  rerender({ request: null }); expect(result.current).toEqual({ data: null, error: null, pending: false });
});

it("ignores a reply after unmount", async () => {
  const request = deferred(); vi.mocked(invoke).mockReturnValue(request.promise);
  const { unmount } = renderHook(() => useMatchingRequest("tracklist_confidence", "{}"));
  unmount(); await act(async () => request.resolve("late")); expect(invoke).toHaveBeenCalledTimes(1);
});
