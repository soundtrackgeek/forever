mod provider;
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
const MAX_ARTISTS: usize = 12;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Seed {
    artist_id: String,
    name: String,
    owned_album_count: u64,
}

struct Inventory {
    seeds: Vec<Seed>,
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

fn inventory(path: &Path) -> Result<Inventory, String> {
    let db = open_read_only(path)?;
    let links = query_artist_links(&db)?;
    let mut query = db.prepare("SELECT album_artist_display, COUNT(*) FROM albums WHERE NULLIF(TRIM(album_artist_display), '') IS NOT NULL GROUP BY album_artist_display COLLATE NOCASE")
        .map_err(|e| format!("Could not read Archive artists: {e}"))?;
    let rows = query
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut result = Inventory {
        seeds: vec![],
        owned_ids: HashSet::new(),
        owned_names: HashSet::new(),
        unresolved_artists: 0,
    };
    let mut seeds: HashMap<String, Seed> = HashMap::new();
    // No UI pagination limit: even artists with one owned album exclude recommendations.
    for row in rows {
        let (name, count) = row.map_err(|e| e.to_string())?;
        let normalized = normalize_title(&name);
        result.owned_names.insert(normalized.clone());
        let Some(link) = links.get(&normalized).filter(|l| mbid(&l.artist_id)) else {
            result.unresolved_artists += 1;
            continue;
        };
        let id = link.artist_id.to_ascii_lowercase();
        result.owned_ids.insert(id.clone());
        if let Some(canonical) = &link.canonical_name {
            result.owned_names.insert(normalize_title(canonical));
        }
        if id == "89ad4ac3-39f7-470e-963a-56509c546377" || normalized == "various artists" {
            continue;
        }
        let seed = seeds.entry(id.clone()).or_insert(Seed {
            artist_id: id,
            name: link.canonical_name.clone().unwrap_or(name),
            owned_album_count: 0,
        });
        seed.owned_album_count += count;
    }
    result.seeds = seeds.into_values().collect();
    result.seeds.sort_by(|a, b| {
        b.owned_album_count
            .cmp(&a.owned_album_count)
            .then(a.name.cmp(&b.name))
            .then(a.artist_id.cmp(&b.artist_id))
    });
    result.seeds.truncate(MAX_SEEDS);
    Ok(result)
}

#[derive(Clone, Deserialize, Serialize)]
struct Similar {
    artist_mbid: Option<String>,
    name: Option<String>,
    comment: Option<String>,
    score: Option<u64>,
    reference_mbid: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    artist_id: String,
    name: String,
    disambiguation: Option<String>,
    score: f64,
    because: Vec<Seed>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryShelf {
    artists: Vec<Recommendation>,
    seeds: Vec<Seed>,
    unresolved_artists: usize,
    notices: Vec<String>,
}

fn rank(inventory: &Inventory, responses: Vec<(Seed, Vec<Similar>)>) -> Vec<Recommendation> {
    let mut combined: HashMap<String, Recommendation> = HashMap::new();
    for (seed, rows) in responses {
        let mut unique: HashMap<String, Similar> = HashMap::new();
        for row in rows.into_iter().take(500) {
            let Some(id) = row
                .artist_mbid
                .as_deref()
                .filter(|id| mbid(id))
                .map(str::to_ascii_lowercase)
            else {
                continue;
            };
            if row
                .reference_mbid
                .as_deref()
                .is_none_or(|reference| !reference.eq_ignore_ascii_case(&seed.artist_id))
                || row.score.unwrap_or(0) == 0
            {
                continue;
            }
            if row
                .name
                .as_ref()
                .is_none_or(|n| n.trim().is_empty() || n.len() > 300)
            {
                continue;
            }
            if unique.get(&id).is_none_or(|old| row.score > old.score) {
                unique.insert(id, row);
            }
        }
        let maximum = unique.values().filter_map(|r| r.score).max().unwrap_or(1) as f64;
        for (id, row) in unique {
            let name = row.name.unwrap();
            if inventory.owned_ids.contains(&id)
                || inventory.owned_names.contains(&normalize_title(&name))
            {
                continue;
            }
            let score =
                row.score.unwrap() as f64 / maximum * (1.0 + seed.owned_album_count as f64).ln();
            let candidate = combined.entry(id.clone()).or_insert(Recommendation {
                artist_id: id,
                name,
                disambiguation: row.comment,
                score: 0.0,
                because: vec![],
            });
            candidate.score += score;
            candidate.because.push(seed.clone());
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
) -> Result<DiscoveryShelf, String> {
    let path = settings::source(&app).path;
    let source_path = path.clone();
    let owned = tokio::task::spawn_blocking(move || inventory(&path))
        .await
        .map_err(|e| e.to_string())??;
    let mut responses = vec![];
    let mut notices = vec![];
    for seed in &owned.seeds {
        let key = format!("similar:{}:{}", provider::ALGORITHM, seed.artist_id);
        match provider
            .get::<Vec<Similar>>(
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
                if let Some(notice) = data.notice {
                    notices.push(notice);
                }
                responses.push((seed.clone(), data.value));
            }
            Err(error) => notices.push(format!("{}: {error}", seed.name)),
        }
    }
    if settings::source(&app).path != source_path {
        return Err("The Archive source changed. Build the shelf again.".into());
    }
    notices.sort();
    notices.dedup();
    Ok(DiscoveryShelf {
        artists: rank(&owned, responses),
        seeds: owned.seeds,
        unresolved_artists: owned.unresolved_artists,
        notices,
    })
}

#[derive(Deserialize, Serialize)]
struct PopularAlbum {
    release_group_mbid: String,
    total_listen_count: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryAlbums {
    albums: Vec<AlbumReleaseGroup>,
    basis: &'static str,
    notices: Vec<String>,
}

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
    albums.truncate(3);
    albums
}

#[tauri::command]
pub async fn discovery_albums(
    artist_id: String,
    provider: State<'_, DiscoveryProvider>,
    musicbrainz: State<'_, MusicBrainzClient>,
) -> Result<DiscoveryAlbums, String> {
    if !mbid(&artist_id) {
        return Err("Choose a valid MusicBrainz artist.".into());
    }
    let artist_id = artist_id.to_ascii_lowercase();
    let catalog = musicbrainz.catalog(&artist_id).await?;
    let mut notices = vec![];
    if catalog.truncated {
        notices.push(
            "MusicBrainz returned a partial catalog; these picks use the available albums.".into(),
        );
    }
    let popular = provider.get::<Vec<PopularAlbum>>(format!("albums:{artist_id}"), &format!("https://api.listenbrainz.org/1/popularity/top-release-groups-for-artist/{artist_id}"), &[]).await;
    let popularity = match popular {
        Ok(data) => {
            if let Some(notice) = data.notice {
                notices.push(notice);
            }
            data.value
        }
        Err(error) => {
            notices.push(format!(
                "{error} Showing MusicBrainz studio albums by release date."
            ));
            vec![]
        }
    };
    let has_scores = catalog.albums.iter().any(|album| {
        album.primary_type.as_deref() == Some("Album")
            && album.secondary_types.is_empty()
            && popularity
                .iter()
                .any(|p| p.release_group_mbid == album.id && p.total_listen_count.unwrap_or(0) > 0)
    });
    Ok(DiscoveryAlbums {
        albums: key_albums(catalog.albums, &popularity),
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
        assert_eq!(owned.seeds.len(), 1);
        assert_eq!(owned.seeds[0].owned_album_count, 3);
        assert_eq!(owned.seeds[0].artist_id, A);
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
            seeds: vec![first.clone(), second.clone()],
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
                (first, rows),
                (second, vec![similar(C, "Pink Floyd", B, 100)]),
            ],
        );
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].artist_id, C);
        assert_eq!(ranked[0].because.len(), 2);
        assert!((ranked[0].score - (11.0_f64.ln() * 0.5 + 6.0_f64.ln())).abs() < 0.00001);
    }

    #[test]
    fn ranking_is_bounded_and_deterministic_for_ties() {
        let first = seed(A, "Queen", 10);
        let owned = Inventory {
            seeds: vec![first.clone()],
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
        let ranked = rank(&owned, vec![(first, rows)]);
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
}
