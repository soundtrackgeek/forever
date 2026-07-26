import { GlobeHemisphereWest } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { countryName } from "../utils/people";

type CountryFlagProps = {
  code: string | null | undefined;
  showName?: boolean;
  className?: string;
};

const flagUrls = import.meta.glob("/node_modules/flag-icons/flags/4x3/*.svg", {
  import: "default",
  query: "?url",
}) as Record<string, () => Promise<string>>;

const loadedFlags = new Map<string, string>();
const pendingFlags = new Map<string, Promise<string>>();

const loadFlag = (code: string) => {
  const path = `/node_modules/flag-icons/flags/4x3/${code}.svg`;
  const loader = flagUrls[path];
  if (!loader) return null;
  const cached = loadedFlags.get(code);
  if (cached) return Promise.resolve(cached);
  const pending = pendingFlags.get(code) ?? loader();
  pendingFlags.set(code, pending);
  return pending.then(
    (url) => {
      loadedFlags.set(code, url);
      pendingFlags.delete(code);
      return url;
    },
    (error: unknown) => {
      pendingFlags.delete(code);
      throw error;
    },
  );
};

function FlagImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <GlobeHemisphereWest className="country-unknown" size={14} weight="light" aria-hidden="true" />;
  }
  return (
    <img
      className="country-flag"
      src={url}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}

export function CountryFlag({ code, showName = false, className = "" }: CountryFlagProps) {
  const normalized = code?.trim().toLowerCase();
  const [loaded, setLoaded] = useState<{ code: string; url: string } | null>(
    () => normalized && loadedFlags.has(normalized)
      ? { code: normalized, url: loadedFlags.get(normalized) ?? "" }
      : null,
  );
  const flagUrl = normalized && loaded?.code === normalized ? loaded.url : undefined;
  const name = countryName(code);

  useEffect(() => {
    if (!normalized) return;
    const request = loadFlag(normalized);
    if (!request) return;
    let active = true;
    void request
      .then((url) => {
        if (active) setLoaded({ code: normalized, url });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [normalized]);

  return (
    <span className={`country-identity ${className}`.trim()} aria-label={name} title={name}>
      {flagUrl ? (
        <FlagImage key={flagUrl} url={flagUrl} />
      ) : (
        <GlobeHemisphereWest className="country-unknown" size={14} weight="light" aria-hidden="true" />
      )}
      {showName && <span>{name}</span>}
    </span>
  );
}
