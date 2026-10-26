import { describe, expect, it } from "vitest";
import { releaseIdentityForGroup } from "./releaseIdentity";
import type { TransferGroup } from "./transfers";
import type { Transfer } from "../types";

const group = (title: string, transfer: Partial<Transfer> = {}) => ({
  title,
  transfers: [{ remoteFilename: "@@share\\Music\\The Actor\\A New Concept Every Day (1984)\\01.flac", ...transfer }],
}) as unknown as TransferGroup;

describe("releaseIdentityForGroup", () => {
  it("splits an 'Artist - Album (Year)' folder name and drops the year", () => {
    expect(releaseIdentityForGroup(group("The Actor - A New Concept Every Day (1984)"))).toEqual({
      releaseGroupId: null, artist: "The Actor", title: "A New Concept Every Day",
    });
  });

  it("prefers the album search that started the transfer", () => {
    expect(releaseIdentityForGroup(group("whatever", { releaseGroupId: "abc", searchAlbum: { artist: "A", title: "B" } }))).toEqual({
      releaseGroupId: "abc", artist: "A", title: "B",
    });
  });

  it("falls back to the share's artist folder when the title has no separator", () => {
    expect(releaseIdentityForGroup(group("A New Concept Every Day [FLAC]"))).toEqual({
      releaseGroupId: null, artist: "The Actor", title: "A New Concept Every Day",
    });
  });
});
