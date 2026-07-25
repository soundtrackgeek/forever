import { describe, expect, it } from "vitest";
import { remoteDirectory } from "./useSoulseekSearch";

describe("Soulseek search result paths", () => {
  it("preserves the exact remote folder used by peer requests", () => {
    expect(
      remoteDirectory("Music\\Liminal Structures\\Night Geometry\\01 - Thresholds.flac"),
    ).toBe("Music\\Liminal Structures\\Night Geometry");
  });

  it("does not invent a folder for a root-level shared file", () => {
    expect(remoteDirectory("single.flac")).toBe("");
  });
});
