import {
  ArrowRight,
  FolderOpen,
  MagnifyingGlass,
  Radio,
  Star,
  Users,
} from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent } from "react";
import type { ConnectionSnapshot, PeopleSnapshot, PersonProfile } from "../types";
import { CountryFlag } from "./CountryFlag";

type BrowseSharesHomeProps = {
  people: PeopleSnapshot;
  connection: ConnectionSnapshot;
  onBrowse: (username: string) => void;
  onOpenConnection: () => void;
};

const presenceLabel = (person: PersonProfile) => {
  if (person.status === "online") return "Online now";
  if (person.status === "away") return "Away";
  if (!person.lastSeenAtMs) return "Not seen this session";
  return "Seen recently";
};

function BrowseAvatar({ person }: { person: PersonProfile }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="browse-suggestion-avatar">
      {person.pictureDataUrl && !failed ? (
        <img src={person.pictureDataUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        person.username.slice(0, 1).toUpperCase()
      )}
      <i className={`is-${person.status}`} />
    </span>
  );
}

export function BrowseSharesHome({
  people,
  connection,
  onBrowse,
  onOpenConnection,
}: BrowseSharesHomeProps) {
  const [username, setUsername] = useState("");
  const online = connection.state === "online";
  const suggestions = useMemo(
    () =>
      [...people.users]
        .filter((person) => !person.blocked && !person.ignored)
        .sort(
          (left, right) =>
            Number(right.favorite) - Number(left.favorite) ||
            right.lastInteractionAtMs - left.lastInteractionAtMs,
        )
        .slice(0, 8),
    [people.users],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = username.trim();
    if (next && online) onBrowse(next);
  };

  return (
    <section className="browse-home" aria-label="Browse shares">
      <header className="browse-home-heading">
        <span className="eyebrow"><FolderOpen size={14} /> Direct collection</span>
        <h1>Browse a listener’s shelves.</h1>
        <p>Open a complete folder tree, search filenames and folders, then take exactly the release files you want.</p>
      </header>

      <div className="browse-entry-panel">
        <div className="browse-entry-copy">
          <span className="browse-entry-orbit"><Radio size={25} weight="thin" /><i /></span>
          <div>
            <span className="eyebrow">Exact listener</span>
            <h2>Who are you looking for?</h2>
            <p>Enter a Soulseek username. Their public share list stays in memory only for this session.</p>
          </div>
        </div>
        <form onSubmit={submit}>
          <MagnifyingGlass size={18} />
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-label="Soulseek username to browse"
            placeholder="Enter an exact username"
            maxLength={80}
          />
          <button type="submit" disabled={!online || !username.trim()}>
            Browse shares <ArrowRight size={15} />
          </button>
        </form>
        {!online ? (
          <button type="button" className="browse-connect-note" onClick={onOpenConnection}>
            Soulseek is offline. Connect before requesting shares.
          </button>
        ) : null}
      </div>

      <section className="browse-suggestions">
        <header>
          <div><span className="eyebrow"><Users size={14} /> Your network</span><h2>Recent and favorite listeners</h2></div>
          <small>{suggestions.length} ready to browse</small>
        </header>
        {suggestions.length ? (
          <div className="browse-suggestion-list">
            {suggestions.map((person) => (
              <button
                type="button"
                onClick={() => onBrowse(person.username)}
                disabled={!online}
                aria-label={`Browse files shared by ${person.username}`}
                key={person.username.toLocaleLowerCase()}
              >
                <BrowseAvatar person={person} />
                <span><strong>{person.username}</strong><small>{presenceLabel(person)}</small></span>
                {person.favorite ? <Star className="browse-favorite" size={13} weight="fill" /> : <CountryFlag code={person.countryCode} />}
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        ) : (
          <div className="browse-suggestions-empty">
            <Users size={26} weight="thin" />
            <p>People you meet through search, messages, and transfers will appear here.</p>
          </div>
        )}
      </section>
    </section>
  );
}
