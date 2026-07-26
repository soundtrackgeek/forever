import {
  CheckCircle,
  CircleNotch,
  MinusCircle,
  Question,
} from "@phosphor-icons/react";
import type { ArchiveAlbumMatch } from "../types";

type ArchiveOwnershipBadgeProps = {
  match?: ArchiveAlbumMatch;
  archiveConnected: boolean;
  loading?: boolean;
  compact?: boolean;
};

export function ArchiveOwnershipBadge({
  match,
  archiveConnected,
  loading = false,
  compact = false,
}: ArchiveOwnershipBadgeProps) {
  const state = loading
    ? "loading"
    : !archiveConnected || !match || match.ownership === "unknown"
      ? "unknown"
      : match.ownership;
  const detail =
    match?.ownership === "owned"
      ? [
          match.localTitle,
          match.localYear,
          match.trackCount ? `${match.trackCount} tracks` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;
  const classState = state === "notOwned" ? "not-owned" : state;

  return (
    <span
      className={`archive-ownership is-${classState} ${compact ? "is-compact" : ""}`}
      title={detail || (state === "unknown" ? "Music Library Archive unavailable" : undefined)}
    >
      {state === "owned" ? (
        <CheckCircle size={13} weight="fill" />
      ) : state === "notOwned" ? (
        <MinusCircle size={13} />
      ) : state === "loading" ? (
        <CircleNotch className="search-spinner" size={13} />
      ) : (
        <Question size={13} />
      )}
      {state === "owned"
        ? "Owned"
        : state === "notOwned"
          ? "Don’t own"
          : state === "loading"
            ? "Checking Archive"
            : "Archive unavailable"}
    </span>
  );
}
