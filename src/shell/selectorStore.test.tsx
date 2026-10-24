import { act, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import { createSelectorStore, selectSnapshot } from "./selectorStore";

describe("shell selectors", () => {
  it("observes new Map and Set identities instead of comparing empty property lists", () => {
    const store = createSelectorStore({ albums: new Map([["one", 1]]), owned: new Set(["one"]) });
    const albums = selectSnapshot(store.getSnapshot, s => s.albums);
    const owned = selectSnapshot(store.getSnapshot, s => s.owned);
    const oldAlbums = albums();
    const oldOwned = owned();
    store.publish({ albums: new Map([["two", 2]]), owned: new Set(["two"]) });
    expect(albums()).not.toBe(oldAlbums);
    expect(albums().get("two")).toBe(2);
    expect(owned()).not.toBe(oldOwned);
    expect(owned().has("two")).toBe(true);
  });

  it("does not render an unrelated workspace during transfer progress and unsubscribes on unmount", () => {
    const store = createSelectorStore({ transferred: 0, unread: 1 });
    const select = selectSnapshot(store.getSnapshot, (state) => ({
      unread: state.unread,
    }));
    const renderWorkspace = vi.fn();
    const unsubscribe = vi.fn();
    const subscribe = (listener: () => void) => {
      const dispose = store.subscribe(listener);
      return () => {
        unsubscribe();
        dispose();
      };
    };
    function Messages() {
      const { unread } = useSyncExternalStore(subscribe, select);
      renderWorkspace();
      return <p>{unread} unread</p>;
    }
    const { unmount } = render(<Messages />);
    act(() => {
      for (let i = 1; i <= 100; i++)
        store.publish({ transferred: i, unread: 1 });
    });
    expect(renderWorkspace).toHaveBeenCalledTimes(1);
    act(() => store.publish({ transferred: 100, unread: 2 }));
    expect(screen.getByText("2 unread")).toBeInTheDocument();
    expect(renderWorkspace).toHaveBeenCalledTimes(2);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("keeps actions stable while calling the latest committed closure", () => {
    const first = vi.fn((name: string) => `old:${name}`);
    const latest = vi.fn((name: string) => `new:${name}`);
    const store = createSelectorStore({ open: first, value: 1 });
    const open = store.getSnapshot().open;
    store.publish({ open: latest, value: 2 });
    expect(store.getSnapshot().open).toBe(open);
    expect(open("rooms")).toBe("new:rooms");
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("rooms");
  });

  it("caches selector objects and observes a changed selection", () => {
    const store = createSelectorStore({
      active: "one",
      rooms: { one: 1, two: 2 },
    });
    const first = selectSnapshot(store.getSnapshot, (state) => ({
      count: state.rooms.one,
    }));
    expect(first()).toBe(first());
    const second = selectSnapshot(store.getSnapshot, (state) => ({
      count: state.rooms.two,
    }));
    expect(second()).toEqual({ count: 2 });
    const previous = second();
    store.publish({ active: "two", rooms: { one: 1, two: 3 } });
    expect(second()).not.toBe(previous);
    expect(second()).toEqual({ count: 3 });
  });
});
