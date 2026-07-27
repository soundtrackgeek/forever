import { describe, expect, it, vi } from "vitest";
import {
  applyUpdateTaskbarBadge,
  createUpdateTaskbarBadgeRgba,
  UPDATE_TASKBAR_BADGE_SIZE,
} from "./updateTaskbarBadge";

const pixelAt = (pixels: Uint8Array, x: number, y: number) => {
  const offset = (y * UPDATE_TASKBAR_BADGE_SIZE + x) * 4;
  return [...pixels.slice(offset, offset + 4)];
};

describe("update taskbar badge", () => {
  it("creates a transparent, gold Windows overlay with a dark update arrow", () => {
    const pixels = createUpdateTaskbarBadgeRgba();

    expect(pixels).toHaveLength(
      UPDATE_TASKBAR_BADGE_SIZE * UPDATE_TASKBAR_BADGE_SIZE * 4,
    );
    expect(pixelAt(pixels, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(pixels, 16, 26)).toEqual([248, 184, 70, 255]);
    expect(pixelAt(pixels, 16, 10)).toEqual([15, 17, 30, 255]);
    expect(pixelAt(pixels, 16, 20)).toEqual([15, 17, 30, 255]);
  });

  it("sets and clears the native overlay without leaking image resources", async () => {
    const image = { close: vi.fn(async () => undefined) };
    const createImage = vi.fn(async () => image);
    const setOverlayIcon = vi.fn(async () => undefined);

    const applied = await applyUpdateTaskbarBadge(true, {
      createImage,
      setOverlayIcon,
    });
    expect(applied).toBe(image);
    expect(createImage).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      UPDATE_TASKBAR_BADGE_SIZE,
      UPDATE_TASKBAR_BADGE_SIZE,
    );
    expect(setOverlayIcon).toHaveBeenLastCalledWith(image);

    await applyUpdateTaskbarBadge(false, { createImage, setOverlayIcon });
    expect(setOverlayIcon).toHaveBeenLastCalledWith(undefined);
    expect(image.close).not.toHaveBeenCalled();
  });
});
