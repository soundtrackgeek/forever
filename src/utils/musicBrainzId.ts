// MusicBrainz release groups and artists are identified by UUIDs. Discovery
// albums that only Discogs lists carry a `discogs:<master id>` id instead,
// which is not a MusicBrainz id and must never be stored as one.
const MUSICBRAINZ_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const musicBrainzId = (value: string | null | undefined): string | null => {
  const id = value?.trim();
  return id && MUSICBRAINZ_ID.test(id) ? id : null;
};
