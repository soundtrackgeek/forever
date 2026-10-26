import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIsInBackground } from "./appFocus";

const mocks = vi.hoisted(() => ({ native: true, focused: vi.fn(), visible: vi.fn(), minimized: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.native }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFocused: mocks.focused, isVisible: mocks.visible, isMinimized: mocks.minimized }),
}));

beforeEach(() => {
  mocks.native = true;
  mocks.focused.mockReset();
  mocks.focused.mockResolvedValue(true);
  mocks.visible.mockResolvedValue(true);
  mocks.minimized.mockResolvedValue(false);
});

describe("deciding whether Forever is in the background", () => {
  it("is in the foreground only when focused, visible and not minimized", async () => {
    expect(await appIsInBackground()).toBe(false);
  });

  it.each([
    ["another program has focus", () => mocks.focused.mockResolvedValue(false)],
    ["it is hidden in the tray", () => mocks.visible.mockResolvedValue(false)],
    ["it is minimized", () => mocks.minimized.mockResolvedValue(true)],
  ])("is in the background when %s", async (_name, arrange) => {
    arrange();
    expect(await appIsInBackground()).toBe(true);
  });

  it("falls back to the page when the window cannot be queried", async () => {
    mocks.focused.mockRejectedValue(new Error("denied"));
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(await appIsInBackground()).toBe(true);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    expect(await appIsInBackground()).toBe(false);
  });

  it("uses the page directly in the browser preview", async () => {
    mocks.native = false;
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(await appIsInBackground()).toBe(true);
    expect(mocks.focused).not.toHaveBeenCalled();
  });
});
