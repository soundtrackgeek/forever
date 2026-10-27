mod credentials;
mod provider;
mod sources;
pub use provider::DiscoveryProvider;

use super::{normalize_title, open_read_only, query_artist_links, settings};
use crate::musicbrainz::{AlbumReleaseGroup, MusicBrainzClient};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};
use tauri::{AppHandle, State};

const MAX_SEEDS: usize = 5;
const MAX_ARTISTS: usize = 24;
const MAX_ALBUMS: usize = 30;
const VARIOUS_ARTISTS: &str = "89ad4ac3-39f7-470e-963a-56509c546377";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Seed {
    artist_id: String,
    name: String,
    owned_album_count: u64,
    /// Whether `artist_id` is a verified MusicBrainz id. Unverified Archive artists can
    /// still seed name-based sources; their id is `name:<normalized name>`.
    #[serde(skip)]
    resolved: bool,
}

struct Inventory {
    /// Every owned artist, most albums first. Includes artists without a verified id.
    all: Vec<Seed>,
    owned_ids: HashSet<String>,
    owned_names: HashSet<String>,
    unresolved_artists: usize,
}

fn mbid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

const CONNECTOR: &str = " & ";

/// The parts of a name around "&", "+" or "and", without "the": "Mike + The
/// Mechanics" and "Mike & The Mechanics" both give [[mike], [mechanics]].
fn name_segments(name: &str) -> Vec<Vec<String>> {
    let mut segments = vec![vec![]];
    for word in crate::matching::words(&name.replace('+', "&")) {
        match word.as_str() {
            "the" => {}
            "and" => segments.push(vec![]),
            _ => segments.last_mut().expect("one segment").push(word),
        }
    }
    segments.retain(|segment| !segment.is_empty());
    segments
}

/// Compares artists by this key rather than by `normalize_title`, so that "The
/// Carpenters" is "Carpenters" and "Go-Go's" is "The Go-Go's".
fn owned_key(name: &str) -> String {
    name_segments(name)
        .iter()
        .map(|segment| segment.join(" "))
        .collect::<Vec<_>>()
        .join(CONNECTOR)
}

fn ends_with_words(long: &[String], short: &[String]) -> bool {
    long.ends_with(short)
}

/// "Hall & Oates" is "Daryl Hall & John Oates": same number of two or more parts,
/// each part of one name ending a part of the other. A single-part name never
/// qualifies, so a solo "John Oates" or "Dave Matthews" is not taken as owned.
fn same_group(a: &str, b: &str) -> bool {
    let (a, b) = (name_segments(a), name_segments(b));
    a.len() >= 2
        && a.len() == b.len()
        && (a.iter().zip(&b).all(|(x, y)| ends_with_words(y, x))
            || a.iter().zip(&b).all(|(x, y)| ends_with_words(x, y)))
}

fn is_owned_name(inventory: &Inventory, name: &str) -> bool {
    let key = owned_key(name);
    inventory.owned_names.contains(&key)
        || (key.contains(CONNECTOR)
            && inventory
                .owned_names
                .iter()
                .any(|owned| owned.contains(CONNECTOR) && same_group(owned, &key)))
}

fn inventory(path: &Path) -> Result<Inventory, String> {
    let db = open_read_only(path)?;
    let links = query_artist_links(&db)?;
    let mut query = db.prepare("SELECT album_artist_display, COUNT(*) FROM albums WHERE NULLIF(TRIM(album_artist_display), '') IS NOT NULL GROUP BY album_artist_display COLLATE NOCASE")
        .map_err(|e| format!("Could not read Archive artists: {e}"))?;
    let rows = query
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut result = Inventory {
        all: vec![],
        owned_ids: HashSet::new(),
        owned_names: HashSet::new(),
        unresolved_artists: 0,
    };
    let mut artists: HashMap<String, Seed> = HashMap::new();
    // No UI pagination limit: even artists with one owned album exclude recommendations.
    for row in rows {
        let (name, count) = row.map_err(|e| e.to_string())?;
        let normalized = normalize_title(&name);
        result.owned_names.insert(owned_key(&name));
        let link = links.get(&normalized).filter(|l| mbid(&l.artist_id));
        let (id, display, resolved) = match link {
            Some(link) => {
                let id = link.artist_id.to_ascii_lowercase();
                result.owned_ids.insert(id.clone());
                if let Some(canonical) = &link.canonical_name {
                    result.owned_names.insert(owned_key(canonical));
                }
                (id, link.canonical_name.clone().unwrap_or(name), true)
            }
            None => {
                result.unresolved_artists += 1;
                (format!("name:{normalized}"), name, false)
            }
        };
        if id == VARIOUS_ARTISTS || normalized.is_empty() || normalized == "various artists" {
            continue;
        }
        artists
            .entry(id.clone())
            .or_insert(Seed {
                artist_id: id,
                name: display,
                owned_album_count: 0,
                resolved,
            })
            .owned_album_count += count;
    }
    result.all = artists.into_values().collect();
    result.all.sort_by(|a, b| {
        b.owned_album_count
            .cmp(&a.owned_album_count)
            .then(a.name.cmp(&b.name))
            .then(a.artist_id.cmp(&b.artist_id))
    });
    Ok(result)
}

/// An artist the user picked from their Archive to steer discovery.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedRequest {
    artist_id: Option<String>,
    name: String,
}

/// The requested artists that really are in the Archive, or, with no request, the
/// most-owned verified artists.
fn choose_seeds(owned: &Inventory, requested: Option<Vec<SeedRequest>>) -> Vec<Seed> {
    let Some(requested) = requested else {
        return owned
            .all
            .iter()
            .filter(|seed| seed.resolved)
            .take(MAX_SEEDS)
            .cloned()
            .collect();
    };
    let mut chosen: Vec<Seed> = vec![];
    for request in requested.iter().take(MAX_SEEDS) {
        let found = request
            .artist_id
            .as_deref()
            .and_then(|id| {
                owned
                    .all
                    .iter()
                    .find(|seed| seed.artist_id.eq_ignore_ascii_case(id))
            })
            .or_else(|| {
                let wanted = normalize_title(&request.name);
                owned
                    .all
                    .iter()
                    .find(|seed| normalize_title(&seed.name) == wanted)
            });
        if let Some(seed) = found {
            if !chosen.iter().any(|c| c.artist_id == seed.artist_id) {
                chosen.push(seed.clone());
            }
        }
    }
    chosen
}

#[derive(Clone, Deserialize, Serialize)]
struct Similar {
    artist_mbid: Option<String>,
    name: Option<String>,
    comment: Option<String>,
    score: Option<u64>,
    reference_mbid: Option<String>,
}

/// One artist suggested by one source, before owned artists are removed.
#[derive(Clone, Debug)]
struct Candidate {
    mbid: Option<String>,
    name: String,
    comment: Option<String>,
    score: f64,
}

struct Block {
    seed: Seed,
    source: &'static str,
    rows: Vec<Candidate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    artist_id: String,
    name: String,
    disambiguation: Option<String>,
    score: f64,
    because: Vec<Seed>,
    sources: Vec<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryShelf {
    artists: Vec<Recommendation>,
    seeds: Vec<Seed>,
    unresolved_artists: usize,
    notices: Vec<String>,
}

fn listenbrainz_candidates(seed: &Seed, rows: Vec<Similar>) -> Vec<Candidate> {
    rows.into_iter()
        .take(500)
        .filter_map(|row| {
            let id = row
                .artist_mbid
                .as_deref()
                .filter(|id| mbid(id))
                .map(str::to_ascii_lowercase)?;
            if row
                .reference_mbid
                .as_deref()
                .is_none_or(|reference| !reference.eq_ignore_ascii_case(&seed.artist_id))
                || row.score.unwrap_or(0) == 0
            {
                return None;
            }
            let name = row
                .name
                .filter(|n| !n.trim().is_empty() && n.len() <= 300)?;
            Some(Candidate {
                mbid: Some(id),
                name,
                comment: row.comment,
                score: row.score.unwrap_or(0) as f64,
            })
        })
        .collect()
}

/// Merges sources by artist name (Last.fm often has no MusicBrainz id), removes owned
/// artists, and weights each seed by how much of it you own.
fn rank(inventory: &Inventory, blocks: Vec<Block>) -> Vec<Recommendation> {
    let mut combined: HashMap<String, Recommendation> = HashMap::new();
    for Block { seed, source, rows } in blocks {
        let mut unique: HashMap<String, Candidate> = HashMap::new();
        for row in rows {
            let key = normalize_title(&row.name);
            if key.is_empty() {
                continue;
            }
            match unique.get_mut(&key) {
                Some(old) => {
                    if old.mbid.is_none() {
                        old.mbid = row.mbid.clone();
                    }
                    if row.score > old.score {
                        old.score = row.score;
                        old.comment = row.comment;
                    }
                }
                None => {
                    unique.insert(key, row);
                }
            }
        }
        let maximum = unique
            .values()
            .map(|r| r.score)
            .fold(0.0_f64, f64::max)
            .max(f64::MIN_POSITIVE);
        for (key, row) in unique {
            if row
                .mbid
                .as_ref()
                .is_some_and(|id| inventory.owned_ids.contains(id))
                || is_owned_name(inventory, &row.name)
            {
                continue;
            }
            let score = row.score / maximum * (1.0 + seed.owned_album_count as f64).ln();
            let candidate = combined
                .entry(key.clone())
                .or_insert_with(|| Recommendation {
                    artist_id: row.mbid.clone().unwrap_or_else(|| format!("name:{key}")),
                    name: row.name.clone(),
                    disambiguation: row.comment.clone(),
                    score: 0.0,
                    because: vec![],
                    sources: vec![],
                });
            if let (true, Some(id)) = (candidate.artist_id.starts_with("name:"), &row.mbid) {
                candidate.artist_id = id.clone();
            }
            if candidate.disambiguation.is_none() {
                candidate.disambiguation = row.comment;
            }
            candidate.score += score;
            if !candidate
                .because
                .iter()
                .any(|s| s.artist_id == seed.artist_id)
            {
                candidate.because.push(seed.clone());
            }
            if !candidate.sources.contains(&source) {
                candidate.sources.push(source);
            }
        }
    }
    let mut ranked: Vec<_> = combined.into_values().collect();
    ranked.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then(a.name.cmp(&b.name))
            .then(a.artist_id.cmp(&b.artist_id))
    });
    ranked.truncate(MAX_ARTISTS);
    ranked
}

#[tauri::command]
pub async fn discovery_shelf(
    app: AppHandle,
    provider: State<'_, DiscoveryProvider>,
    seeds: Option<Vec<SeedRequest>>,
) -> Result<DiscoveryShelf, String> {
    let steered = seeds.is_some();
    let path = settings::source(&app).path;
    let source_path = path.clone();
    let owned = tokio::task::spawn_blocking(move || inventory(&path))
        .await
        .map_err(|e| e.to_string())??;
    let chosen = choose_seeds(&owned, seeds);
    let mut blocks = vec![];
    let mut notices = vec![];
    let mut lastfm_missing = false;
    if steered && chosen.is_empty() {
        notices.push("Choose an artist from your Archive to start from.".into());
    }
    for seed in &chosen {
        if seed.resolved {
            let key = format!("similar:{}:{}", provider::ALGORITHM, seed.artist_id);
            match sources::listenbrainz_get::<Vec<Similar>>(
                &provider,
                key,
                "https://labs.api.listenbrainz.org/similar-artists/json",
                &[
                    ("artist_mbids", &seed.artist_id),
                    ("algorithm", provider::ALGORITHM),
                ],
            )
            .await
            {
                Ok(data) => {
                    notices.extend(data.notice);
                    blocks.push(Block {
                        seed: seed.clone(),
                        source: "ListenBrainz",
                        rows: listenbrainz_candidates(seed, data.value),
                    });
                }
                Err(error) => notices.push(format!("{}: {error}", seed.name)),
            }
        }
        let id = seed.resolved.then_some(seed.artist_id.as_str());
        match sources::lastfm_similar(&provider, id, &seed.name).await {
            Ok(Some(data)) => {
                notices.extend(data.notice);
                blocks.push(Block {
                    seed: seed.clone(),
                    source: "Last.fm",
                    rows: data.value,
                });
            }
            Ok(None) => lastfm_missing = true,
            Err(error) => notices.push(error),
        }
    }
    if lastfm_missing {
        notices
            .push("Add a Last.fm API key under Sources to include Last.fm similar artists.".into());
        if chosen.iter().any(|seed| !seed.resolved) {
            notices.push("Some chosen artists have no verified MusicBrainz identity, so only Last.fm can follow them.".into());
        }
    }
    if settings::source(&app).path != source_path {
        return Err("The Archive source changed. Build the shelf again.".into());
    }
    notices.sort();
    notices.dedup();
    Ok(DiscoveryShelf {
        artists: rank(&owned, blocks),
        seeds: chosen,
        unresolved_artists: owned.unresolved_artists,
        notices,
    })
}

#[tauri::command]
pub fn discovery_sources_status() -> credentials::SourcesStatus {
    credentials::all_status()
}

#[tauri::command]
pub fn discovery_save_source(
    source: String,
    key: String,
    secret: Option<String>,
) -> Result<credentials::SourcesStatus, String> {
    credentials::save(
        credentials::Source::parse(&source)?,
        &key,
        secret.as_deref(),
    )?;
    Ok(credentials::all_status())
}

#[tauri::command]
pub fn discovery_clear_source(source: String) -> Result<credentials::SourcesStatus, String> {
    credentials::clear(credentials::Source::parse(&source)?)?;
    Ok(credentials::all_status())
}

#[derive(Deserialize, Serialize)]
struct PopularAlbum {
    release_group_mbid: String,
    total_listen_count: Option<u64>,
}

/// What one catalog said about the artist's studio albums.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReport {
    /// `found`, `empty`, `unavailable`, or `notConfigured`.
    status: &'static str,
    count: usize,
    message: Option<String>,
}

impl SourceReport {
    fn found(count: usize) -> Self {
        Self {
            status: if count == 0 { "empty" } else { "found" },
            count,
            message: None,
        }
    }
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: "unavailable",
            count: 0,
            message: Some(message.into()),
        }
    }
    fn not_configured() -> Self {
        Self {
            status: "notConfigured",
            count: 0,
            message: None,
        }
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryAlbum {
    /// A MusicBrainz release-group id, or `discogs:<master id>` when only Discogs has it.
    id: String,
    title: String,
    first_release_date: String,
    cover_art_url: String,
    musicbrainz: bool,
    discogs: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryAlbums {
    albums: Vec<DiscoveryAlbum>,
    musicbrainz: SourceReport,
    discogs: SourceReport,
    /// Set once the artist is identified on MusicBrainz, even if it came from a name.
    musicbrainz_artist_id: Option<String>,
    image_url: Option<String>,
    basis: &'static str,
    notices: Vec<String>,
}

/// Studio albums only, best-listened first, then by release date.
fn key_albums(
    catalog: Vec<AlbumReleaseGroup>,
    popularity: &[PopularAlbum],
) -> Vec<AlbumReleaseGroup> {
    let scores: HashMap<_, _> = popularity
        .iter()
        .filter(|a| mbid(&a.release_group_mbid))
        .map(|a| {
            (
                a.release_group_mbid.to_ascii_lowercase(),
                a.total_listen_count.unwrap_or(0),
            )
        })
        .collect();
    let mut albums: Vec<_> = catalog
        .into_iter()
        .filter(|a| a.primary_type.as_deref() == Some("Album") && a.secondary_types.is_empty())
        .collect();
    albums.sort_by(|a, b| {
        scores
            .get(&b.id)
            .unwrap_or(&0)
            .cmp(scores.get(&a.id).unwrap_or(&0))
            .then(a.first_release_date.cmp(&b.first_release_date))
            .then(a.id.cmp(&b.id))
    });
    albums
}

/// MusicBrainz albums first (they carry ids and cover art), each flagged when Discogs
/// agrees; then albums only Discogs lists.
fn merge_albums(
    musicbrainz: Vec<AlbumReleaseGroup>,
    discogs: Vec<sources::DiscogsAlbum>,
) -> Vec<DiscoveryAlbum> {
    let discogs_keys: HashSet<_> = discogs.iter().map(|a| normalize_title(&a.title)).collect();
    let musicbrainz_keys: HashSet<_> = musicbrainz
        .iter()
        .map(|a| normalize_title(&a.title))
        .collect();
    let mut merged: Vec<_> = musicbrainz
        .into_iter()
        .map(|album| DiscoveryAlbum {
            discogs: discogs_keys.contains(&normalize_title(&album.title)),
            id: album.id,
            title: album.title,
            first_release_date: album.first_release_date,
            cover_art_url: album.cover_art_url,
            musicbrainz: true,
        })
        .collect();
    merged.extend(
        discogs
            .into_iter()
            .filter(|a| !musicbrainz_keys.contains(&normalize_title(&a.title)))
            .map(|a| DiscoveryAlbum {
                id: format!("discogs:{}", a.id),
                title: a.title,
                first_release_date: a.year.map(|y| y.to_string()).unwrap_or_default(),
                cover_art_url: String::new(),
                musicbrainz: false,
                discogs: true,
            }),
    );
    merged.truncate(MAX_ALBUMS);
    merged
}

struct MusicBrainzSide {
    artist_id: Option<String>,
    albums: Vec<AlbumReleaseGroup>,
    report: SourceReport,
    notices: Vec<String>,
}

/// Finds the artist on MusicBrainz (by id, or by an exact name match) and lists
/// their studio albums.
async fn musicbrainz_side(
    musicbrainz: &MusicBrainzClient,
    artist_id: &str,
    name: &str,
) -> MusicBrainzSide {
    let mut notices = vec![];
    let id = if mbid(artist_id) {
        Some(artist_id.to_ascii_lowercase())
    } else {
        match musicbrainz.search_artists(name).await {
            Ok(found) => {
                let wanted = normalize_title(name);
                found
                    .into_iter()
                    .find(|a| a.score >= 90 && normalize_title(&a.name) == wanted)
                    .map(|a| a.id.to_ascii_lowercase())
            }
            Err(error) => {
                return MusicBrainzSide {
                    artist_id: None,
                    albums: vec![],
                    report: SourceReport::unavailable(error),
                    notices,
                };
            }
        }
    };
    let Some(id) = id else {
        return MusicBrainzSide {
            artist_id: None,
            albums: vec![],
            report: SourceReport::found(0),
            notices: vec!["MusicBrainz has no artist with exactly this name.".into()],
        };
    };
    match musicbrainz.catalog(&id).await {
        Ok(catalog) => {
            if catalog.truncated {
                notices.push(
                    "MusicBrainz returned a partial catalog; some albums may be missing.".into(),
                );
            }
            let albums = key_albums(catalog.albums, &[]);
            MusicBrainzSide {
                artist_id: Some(id),
                report: SourceReport::found(albums.len()),
                albums,
                notices,
            }
        }
        Err(error) => MusicBrainzSide {
            artist_id: Some(id),
            albums: vec![],
            report: SourceReport::unavailable(error),
            notices,
        },
    }
}

#[tauri::command]
pub async fn discovery_albums(
    artist_id: String,
    name: String,
    provider: State<'_, DiscoveryProvider>,
    musicbrainz: State<'_, MusicBrainzClient>,
) -> Result<DiscoveryAlbums, String> {
    let name = name.trim().to_owned();
    let valid_id = mbid(&artist_id) || artist_id.starts_with("name:");
    if !valid_id || name.is_empty() || name.len() > 300 || name.chars().any(char::is_control) {
        return Err("Choose a valid artist.".into());
    }
    let (side, discogs) = tokio::join!(
        musicbrainz_side(&musicbrainz, &artist_id, &name),
        sources::discogs_albums(&provider, &name)
    );
    let mut notices = side.notices;
    let (discogs_albums, discogs_report) = match discogs {
        Ok(Some(data)) => {
            notices.extend(data.notice);
            let report = SourceReport::found(data.value.len());
            (data.value, report)
        }
        Ok(None) => (vec![], SourceReport::not_configured()),
        Err(error) => (vec![], SourceReport::unavailable(error)),
    };
    let mut albums = side.albums;
    let mut has_scores = false;
    if let Some(id) = side.artist_id.as_deref().filter(|_| !albums.is_empty()) {
        let url =
            format!("https://api.listenbrainz.org/1/popularity/top-release-groups-for-artist/{id}");
        match sources::listenbrainz_get::<Vec<PopularAlbum>>(
            &provider,
            format!("albums:{id}"),
            &url,
            &[],
        )
        .await
        {
            Ok(data) => {
                notices.extend(data.notice);
                has_scores = albums.iter().any(|album| {
                    data.value.iter().any(|p| {
                        p.release_group_mbid == album.id && p.total_listen_count.unwrap_or(0) > 0
                    })
                });
                albums = key_albums(albums, &data.value);
            }
            Err(error) => notices.push(format!("{error} Showing albums by release date.")),
        }
    }
    let image_url = match side.artist_id.as_deref() {
        Some(id) => sources::fanart_image(&provider, id).await.unwrap_or(None),
        None => None,
    };
    notices.sort();
    notices.dedup();
    Ok(DiscoveryAlbums {
        albums: merge_albums(albums, discogs_albums),
        musicbrainz: side.report,
        discogs: discogs_report,
        musicbrainz_artist_id: side.artist_id,
        image_url,
        basis: if has_scores {
            "listenbrainz"
        } else {
            "catalog"
        },
        notices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "0383dadf-2a4e-4d10-a46a-e9e041da8eb3";
    const B: &str = "5441c29d-3602-4898-b1a1-b77fa23b8e50";
    const C: &str = "83d91898-7763-47d7-b03b-b92132375c47";
    fn seed(id: &str, name: &str, count: u64) -> Seed {
        Seed {
            artist_id: id.into(),
            name: name.into(),
            owned_album_count: count,
            resolved: true,
        }
    }
    fn block(seed: &Seed, rows: Vec<Similar>) -> Block {
        Block {
            seed: seed.clone(),
            source: "ListenBrainz",
            rows: listenbrainz_candidates(seed, rows),
        }
    }
    fn similar(id: &str, name: &str, reference: &str, score: u64) -> Similar {
        Similar {
            artist_mbid: Some(id.into()),
            name: Some(name.into()),
            reference_mbid: Some(reference.into()),
            score: Some(score),
            comment: None,
        }
    }

    #[test]
    fn reads_all_owned_artists_merges_verified_aliases_and_preserves_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE albums (album_artist_display TEXT); CREATE TABLE musicbrainz_artist_links (display_artist TEXT, mbid TEXT, canonical_name TEXT, ignored INTEGER, verification_state TEXT);").unwrap();
        for name in ["Queen", "QUEEN", "Queen alias", "Björk", "Unverified"] {
            db.execute("INSERT INTO albums VALUES (?1)", [name])
                .unwrap();
        }
        for name in ["Queen", "Queen alias"] {
            db.execute(
                "INSERT INTO musicbrainz_artist_links VALUES (?1,?2,'Queen',0,'verified')",
                rusqlite::params![name, A.to_uppercase()],
            )
            .unwrap();
        }
        db.execute("INSERT INTO musicbrainz_artist_links VALUES ('Unverified',?1,'Unverified',0,'pending')", [B]).unwrap();
        for n in 0..150 {
            db.execute("INSERT INTO albums VALUES (?1)", [format!("Owned {n}")])
                .unwrap();
        }
        drop(db);
        let before = std::fs::read(&path).unwrap();
        let owned = inventory(&path).unwrap();
        let verified: Vec<_> = owned.all.iter().filter(|s| s.resolved).collect();
        assert_eq!(verified.len(), 1);
        assert_eq!(verified[0].owned_album_count, 3);
        assert_eq!(verified[0].artist_id, A);
        // Unverified artists can still be chosen as name-only seeds.
        assert!(owned
            .all
            .iter()
            .any(|s| !s.resolved && s.artist_id == "name:unverified"));
        assert!(owned.owned_names.contains("owned 149"));
        assert!(owned.owned_names.contains("bjork"));
        assert!(!owned.owned_ids.contains(B));
        assert_eq!(before, std::fs::read(&path).unwrap());
    }

    #[test]
    fn combines_affinities_deduplicates_and_excludes_owned_ids_and_names() {
        let first = seed(A, "Queen", 10);
        let second = seed(B, "Bowie", 5);
        let owned = Inventory {
            all: vec![first.clone(), second.clone()],
            owned_ids: HashSet::from([A.into(), B.into()]),
            owned_names: HashSet::from(["bjork".into(), "owned 149".into()]),
            unresolved_artists: 0,
        };
        let rows = vec![
            similar(C, "Pink Floyd", A, 50),
            similar(C, "Pink Floyd", A, 50),
            similar(B, "Different alias", A, 100),
            similar("00000000-0000-0000-0000-000000000001", "Björk", A, 90),
            similar("00000000-0000-0000-0000-000000000002", "Owned 149", A, 80),
            similar("bad", "Invalid", A, 500),
            similar(
                "00000000-0000-0000-0000-000000000003",
                "Wrong reference",
                C,
                100,
            ),
        ];
        let ranked = rank(
            &owned,
            vec![
                block(&first, rows),
                block(&second, vec![similar(C, "Pink Floyd", B, 100)]),
            ],
        );
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].artist_id, C);
        assert_eq!(ranked[0].because.len(), 2);
        assert!((ranked[0].score - (11.0_f64.ln() * 0.5 + 6.0_f64.ln())).abs() < 0.00001);
    }

    #[test]
    fn owned_artists_match_despite_the_connectors_and_group_forms() {
        let first = seed(A, "Queen", 10);
        let names = [
            "Carpenters",
            "The Go-Go's",
            "Mike & The Mechanics",
            "Daryl Hall & John Oates",
            "Dave Matthews Band",
            "Nick Cave",
        ];
        let owned = Inventory {
            all: vec![first.clone()],
            owned_ids: HashSet::new(),
            owned_names: names.iter().map(|name| owned_key(name)).collect(),
            unresolved_artists: 0,
        };
        let candidates = [
            "The Carpenters",
            "Go-Go's",
            "Mike + The Mechanics",
            "Hall & Oates",
            "Hall and Oates",
            // Not owned: solo members, shortened bands and near misses.
            "John Oates",
            "Daryl Hall",
            "Dave Matthews",
            "Nick Cave & The Bad Seeds",
            "Mike Oldfield",
            "The Carpenter Ants",
        ];
        let rows = candidates
            .iter()
            .enumerate()
            .map(|(i, name)| similar(&format!("00000000-0000-0000-0000-{i:012}"), name, A, 50))
            .collect();
        let kept: Vec<_> = rank(&owned, vec![block(&first, rows)])
            .into_iter()
            .map(|r| r.name)
            .collect();
        for name in &candidates[..5] {
            assert!(!kept.contains(&name.to_string()), "{name} is owned");
        }
        for name in &candidates[5..] {
            assert!(kept.contains(&name.to_string()), "{name} is not owned");
        }
    }

    #[test]
    fn ranking_is_bounded_and_deterministic_for_ties() {
        let first = seed(A, "Queen", 10);
        let owned = Inventory {
            all: vec![first.clone()],
            owned_ids: HashSet::new(),
            owned_names: HashSet::new(),
            unresolved_artists: 0,
        };
        let rows: Vec<_> = (0..30)
            .rev()
            .map(|i| {
                similar(
                    &format!("00000000-0000-0000-0000-{i:012}"),
                    &format!("Artist {i:02}"),
                    A,
                    10,
                )
            })
            .collect();
        let ranked = rank(&owned, vec![block(&first, rows)]);
        assert_eq!(ranked.len(), MAX_ARTISTS);
        assert_eq!(ranked[0].name, "Artist 00");
    }

    #[test]
    fn key_albums_require_catalog_membership_and_exclude_live_compilations() {
        let album = |id: &str, date: &str, types: Vec<String>| AlbumReleaseGroup {
            id: id.into(),
            title: id.into(),
            first_release_date: date.into(),
            primary_type: Some("Album".into()),
            secondary_types: types,
            cover_art_url: String::new(),
        };
        let picks = key_albums(
            vec![
                album(A, "1970", vec![]),
                album(B, "1980", vec![]),
                album(C, "1960", vec!["Live".into()]),
            ],
            &[
                PopularAlbum {
                    release_group_mbid: B.into(),
                    total_listen_count: Some(100),
                },
                PopularAlbum {
                    release_group_mbid: C.into(),
                    total_listen_count: Some(1000),
                },
                PopularAlbum {
                    release_group_mbid: "00000000-0000-0000-0000-000000000001".into(),
                    total_listen_count: Some(10000),
                },
            ],
        );
        assert_eq!(
            picks.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            vec![B, A]
        );
        assert!(!mbid("../../bad"));
        assert!(!mbid("000000000000000000000000000000000000"));
    }

    fn candidate(mbid: Option<&str>, name: &str, score: f64) -> Candidate {
        Candidate {
            mbid: mbid.map(Into::into),
            name: name.into(),
            comment: None,
            score,
        }
    }

    #[test]
    fn merges_sources_by_name_and_keeps_the_musicbrainz_id() {
        let seed = seed(A, "Queen", 10);
        let owned = Inventory {
            all: vec![seed.clone()],
            owned_ids: HashSet::new(),
            owned_names: HashSet::from(["bjork".into()]),
            unresolved_artists: 0,
        };
        let ranked = rank(
            &owned,
            vec![
                Block {
                    seed: seed.clone(),
                    source: "Last.fm",
                    rows: vec![
                        candidate(None, "Pink Floyd", 1.0),
                        candidate(None, "Björk", 0.9),
                        candidate(None, "Solo Source", 0.2),
                    ],
                },
                Block {
                    seed: seed.clone(),
                    source: "ListenBrainz",
                    rows: vec![candidate(Some(C), "pink floyd", 40.0)],
                },
            ],
        );
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].name, "Pink Floyd");
        assert_eq!(ranked[0].artist_id, C);
        assert_eq!(ranked[0].sources, vec!["Last.fm", "ListenBrainz"]);
        // One seed counted once even though two sources agree on it.
        assert_eq!(ranked[0].because.len(), 1);
        assert!((ranked[0].score - 2.0 * 11.0_f64.ln()).abs() < 1e-9);
        assert_eq!(ranked[1].artist_id, "name:solo source");
        assert_eq!(ranked[1].sources, vec!["Last.fm"]);
    }

    #[test]
    fn steered_seeds_must_be_in_the_archive_and_are_not_repeated() {
        let owned = Inventory {
            all: vec![
                seed(A, "Queen", 10),
                Seed {
                    artist_id: "name:richard marx".into(),
                    name: "Richard Marx".into(),
                    owned_album_count: 4,
                    resolved: false,
                },
            ],
            owned_ids: HashSet::new(),
            owned_names: HashSet::new(),
            unresolved_artists: 1,
        };
        let request = |id: Option<&str>, name: &str| SeedRequest {
            artist_id: id.map(Into::into),
            name: name.into(),
        };
        let chosen = choose_seeds(
            &owned,
            Some(vec![
                request(Some(&A.to_uppercase()), "Queen"),
                request(None, "QUEEN"),
                request(None, "richard marx"),
                request(Some(C), "Pink Floyd"),
            ]),
        );
        assert_eq!(
            chosen.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["Queen", "Richard Marx"]
        );
        assert!(choose_seeds(&owned, Some(vec![])).is_empty());
        // Without a request only verified artists seed the shelf.
        let automatic = choose_seeds(&owned, None);
        assert_eq!(automatic.len(), 1);
        assert_eq!(automatic[0].artist_id, A);
    }

    #[test]
    fn merged_albums_flag_agreement_and_append_discogs_only_titles() {
        let mb = |id: &str, title: &str, date: &str| AlbumReleaseGroup {
            id: id.into(),
            title: title.into(),
            first_release_date: date.into(),
            primary_type: Some("Album".into()),
            secondary_types: vec![],
            cover_art_url: "cover".into(),
        };
        let discogs = |id: i64, title: &str, year: i32| sources::DiscogsAlbum {
            id,
            title: title.into(),
            year: Some(year),
        };
        let merged = merge_albums(
            vec![
                mb(A, "Repeat Offender", "1989-05-16"),
                mb(B, "Rush Street", "1991"),
            ],
            vec![
                discogs(1, "Repeat  Offender", 1989),
                discogs(2, "Paid Vacation", 1994),
            ],
        );
        assert_eq!(merged.len(), 3);
        assert!(merged[0].musicbrainz && merged[0].discogs);
        assert!(merged[1].musicbrainz && !merged[1].discogs);
        assert_eq!(merged[2].id, "discogs:2");
        assert!(!merged[2].musicbrainz && merged[2].discogs);
        assert_eq!(merged[2].first_release_date, "1994");
        assert_eq!(merged[2].cover_art_url, "");
    }
}
