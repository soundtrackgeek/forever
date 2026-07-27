export const UPDATE_TASKBAR_BADGE_SIZE = 32;

export type TaskbarBadgeImage = {
  close: () => Promise<void>;
};

type TaskbarBadgeDependencies<TImage extends TaskbarBadgeImage> = {
  createImage: (
    rgba: Uint8Array,
    width: number,
    height: number,
  ) => Promise<TImage>;
  setOverlayIcon: (image?: TImage) => Promise<void>;
};

const GOLD = [248, 184, 70] as const;
const GOLD_EDGE = [255, 231, 163] as const;
const INK = [15, 17, 30] as const;
const SAMPLE_GRID = 4;

const insideArrow = (x: number, y: number, center: number, scale: number) => {
  const stemHalfWidth = 2.15 * scale;
  const stemTop = 13.25 * scale;
  const stemBottom = 23.25 * scale;
  const pointY = 7.25 * scale;
  const shoulderY = 15.5 * scale;
  const headHalfWidth = 8 * scale;
  const relativeX = Math.abs(x - center);

  if (
    relativeX <= stemHalfWidth
    && y >= stemTop
    && y <= stemBottom
  ) {
    return true;
  }

  if (y < pointY || y > shoulderY) return false;
  const allowedHalfWidth = ((y - pointY) / (shoulderY - pointY)) * headHalfWidth;
  return relativeX <= allowedHalfWidth;
};

export function createUpdateTaskbarBadgeRgba(
  size = UPDATE_TASKBAR_BADGE_SIZE,
) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = size / UPDATE_TASKBAR_BADGE_SIZE;
  const center = size / 2;
  const radius = 14.5 * scale;
  const edgeStart = 12.75 * scale;
  const samplesPerPixel = SAMPLE_GRID * SAMPLE_GRID;

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let sampleY = 0; sampleY < SAMPLE_GRID; sampleY += 1) {
        for (let sampleX = 0; sampleX < SAMPLE_GRID; sampleX += 1) {
          const x = pixelX + (sampleX + 0.5) / SAMPLE_GRID;
          const y = pixelY + (sampleY + 0.5) / SAMPLE_GRID;
          const distance = Math.hypot(x - center, y - center);
          if (distance > radius) continue;

          const color = insideArrow(x, y, center, scale)
            ? INK
            : distance >= edgeStart
              ? GOLD_EDGE
              : GOLD;
          red += color[0];
          green += color[1];
          blue += color[2];
          alpha += 255;
        }
      }

      if (alpha === 0) continue;
      const coveredSamples = alpha / 255;
      const offset = (pixelY * size + pixelX) * 4;
      pixels[offset] = Math.round(red / coveredSamples);
      pixels[offset + 1] = Math.round(green / coveredSamples);
      pixels[offset + 2] = Math.round(blue / coveredSamples);
      pixels[offset + 3] = Math.round(alpha / samplesPerPixel);
    }
  }

  return pixels;
}

export async function applyUpdateTaskbarBadge<TImage extends TaskbarBadgeImage>(
  available: boolean,
  { createImage, setOverlayIcon }: TaskbarBadgeDependencies<TImage>,
) {
  if (!available) {
    await setOverlayIcon(undefined);
    return null;
  }

  const image = await createImage(
    createUpdateTaskbarBadgeRgba(),
    UPDATE_TASKBAR_BADGE_SIZE,
    UPDATE_TASKBAR_BADGE_SIZE,
  );
  try {
    await setOverlayIcon(image);
    return image;
  } catch (cause) {
    await image.close();
    throw cause;
  }
}
