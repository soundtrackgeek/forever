import { Bell, BellSlash, CircleNotch } from "@phosphor-icons/react";
import { useState } from "react";

type WantedToggleProps = {
  watched: boolean;
  albumTitle: string;
  compact?: boolean;
  onToggle: () => Promise<unknown>;
};

export function WantedToggle({
  watched,
  albumTitle,
  compact = false,
  onToggle,
}: WantedToggleProps) {
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    setPending(true);
    try {
      await onToggle();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className={`wanted-toggle ${watched ? "is-watched" : ""} ${compact ? "is-compact" : ""}`}
      disabled={pending}
      aria-pressed={watched}
      aria-label={`${watched ? "Remove" : "Add"} ${albumTitle} ${watched ? "from" : "to"} Wanted`}
      title={watched ? "Remove from Wanted" : "Watch for new Soulseek sources"}
      onClick={() => void toggle().catch(() => undefined)}
    >
      {pending ? (
        <CircleNotch className="search-spinner" size={15} />
      ) : watched ? (
        <BellSlash size={15} />
      ) : (
        <Bell size={15} />
      )}
      {watched ? "Watching" : compact ? "Watch" : "Add to Wanted"}
    </button>
  );
}
