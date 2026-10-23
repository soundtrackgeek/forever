import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ArchiveAlbumMatch } from "../types";
import { ArchiveOwnershipBadge } from "./ArchiveOwnershipBadge";

const match: ArchiveAlbumMatch = {
  albumId: "release", ownership: "owned", matchMethod: "releaseGroupMbid",
  matchedReleaseGroupId: "12fa3845-7c62-36e5-a8da-8be137155a72",
  localAlbumId: "local", localTitle: "Hysteria", localArtist: "Def Leppard", localYear: 1987, trackCount: 12,
};

describe("Archive ownership evidence", () => {
  it("distinguishes MBID and title evidence and exposes the local identity", () => {
    const { rerender } = render(<ArchiveOwnershipBadge match={match} archiveConnected />);
    expect(screen.getByTitle(/Release-group MBID match/)).toHaveTextContent("Owned · MBID");
    expect(screen.getByTitle(/Local album: local/)).toHaveAttribute("title", expect.stringContaining(match.matchedReleaseGroupId!));
    rerender(<ArchiveOwnershipBadge match={{ ...match, matchMethod: "normalizedTitle", matchedReleaseGroupId: null }} archiveConnected />);
    expect(screen.getByTitle(/Normalized artist\/title match/)).toHaveTextContent("Owned · Title");
  });

  it("does not expose stale ownership evidence when disconnected or checking", () => {
    const { rerender } = render(<ArchiveOwnershipBadge match={match} archiveConnected={false} />);
    expect(screen.queryByTitle(/Release-group MBID match/)).not.toBeInTheDocument();
    expect(screen.getByText("Archive unavailable")).toBeInTheDocument();
    rerender(<ArchiveOwnershipBadge match={match} archiveConnected loading />);
    expect(screen.getByText("Checking Archive")).toBeInTheDocument();
    expect(screen.queryByTitle(/Release-group MBID match/)).not.toBeInTheDocument();
  });
});
