//! Last.fm, Discogs and Fanart.tv lookups used by the discovery shelf.
//!
//! Each function returns `Ok(None)` when its key is not configured, so callers can
//! skip a source quietly and say why in a notice.
use super::credentials::{self, Source};
use super::provider::{self, Data, DiscoveryProvider};
use super::{mbid, Candidate};
use crate::archive::normalize_title;
use serde::{Deserialize, Deserializer, Serialize};

const LASTFM_URL: &str = "https://ws.audioscrobbler.com/2.0/";
const DISCOGS_SEARCH_URL: &str = "https://api.discogs.com/database/search";
const FANART_URL: &str = "https://webservice.fanart.tv/v3/music";
const SIMILAR_LIMIT: &str = "50";

fn flexible_f64<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<f64>, D::Error> {
    Ok(match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

fn flexible_year<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i32>, D::Error> {
    Ok(match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Number(n) => n.as_i64().and_then(|y| i32::try_from(y).ok()),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

// ---- Last.fm -------------------------------------------------------------

#[derive(Default, Deserialize, Serialize)]
pub(super) struct LastFmSimilar {
    #[serde(default)]
    error: Option<i64>,
    #[serde(default)]
    similarartists: Option<LastFmArtists>,
}

#[derive(Default, Deserialize, Serialize)]
struct LastFmArtists {
    #[serde(default)]
    artist: Vec<LastFmArtist>,
}

#[derive(Deserialize, Serialize)]
struct LastFmArtist {
    name: String,
    #[serde(default)]
    mbid: Option<String>,
    #[serde(default, rename = "match", deserialize_with = "flexible_f64")]
    score: Option<f64>,
}

/// Error 6 means Last.fm does not know the artist; that is an empty answer, not a failure.
fn check_lastfm(response: &LastFmSimilar) -> Result<(), String> {
    match response.error {
        None | Some(6) => Ok(()),
        Some(10 | 26) => Err("Last.fm rejected the API key. Check it under Sources.".into()),
        Some(29) => Err("Last.fm rate limit reached. Try again shortly.".into()),
        Some(code) => Err(format!("Last.fm could not answer (code {code}).")),
    }
}

fn lastfm_candidates(response: LastFmSimilar) -> Vec<Candidate> {
    response
        .similarartists
        .unwrap_or_default()
        .artist
        .into_iter()
        .filter_map(|artist| {
            let score = artist.score.filter(|s| *s > 0.0)?;
            (!artist.name.trim().is_empty() && artist.name.len() <= 300).then(|| Candidate {
                mbid: artist
                    .mbid
                    .filter(|id| mbid(id))
                    .map(|id| id.to_ascii_lowercase()),
                name: artist.name,
                comment: None,
                score,
            })
        })
        .collect()
}

/// Similar artists for a seed. Prefers the MusicBrainz id, which is unambiguous, and
/// falls back to the name when Last.fm does not know the id.
pub(super) async fn lastfm_similar(
    provider: &DiscoveryProvider,
    artist_mbid: Option<&str>,
    name: &str,
) -> Result<Option<Data<Vec<Candidate>>>, String> {
    let Some((credential, _)) = credentials::resolve(Source::LastFm)? else {
        return Ok(None);
    };
    let mut lookups: Vec<(&str, String)> = vec![];
    if let Some(id) = artist_mbid {
        lookups.push(("mbid", id.to_owned()));
    }
    lookups.push(("artist", name.to_owned()));
    let mut notice = None;
    for (field, value) in lookups {
        let key = format!("lastfm-similar:{field}:{}", normalize_title(&value));
        let data = provider
            .get_with::<LastFmSimilar>(
                provider::LASTFM,
                key,
                LASTFM_URL,
                &[
                    ("method", "artist.getsimilar"),
                    (field, &value),
                    ("autocorrect", "1"),
                    ("limit", SIMILAR_LIMIT),
                    ("api_key", credential.key.as_str()),
                    ("format", "json"),
                ],
                &[],
                check_lastfm,
            )
            .await?;
        notice = data.notice.or(notice);
        let candidates = lastfm_candidates(data.value);
        if !candidates.is_empty() {
            return Ok(Some(Data {
                value: candidates,
                notice,
            }));
        }
    }
    Ok(Some(Data {
        value: vec![],
        notice,
    }))
}

// ---- Discogs -------------------------------------------------------------

#[derive(Default, Deserialize, Serialize)]
pub(super) struct DiscogsSearch {
    #[serde(default)]
    results: Vec<DiscogsResult>,
}

#[derive(Deserialize, Serialize)]
struct DiscogsResult {
    id: i64,
    title: String,
    #[serde(default, deserialize_with = "flexible_year")]
    year: Option<i32>,
    #[serde(default)]
    format: Vec<String>,
}

#[derive(Clone, Debug)]
pub(super) struct DiscogsAlbum {
    pub id: i64,
    pub title: String,
    pub year: Option<i32>,
}

/// Discogs names homonyms "Name (2)". The number is not part of the artist's name.
fn strip_numeric_suffix(value: &str) -> &str {
    let Some(open) = value.rfind(" (") else {
        return value;
    };
    let suffix = &value[open + 2..];
    if suffix.ends_with(')')
        && suffix[..suffix.len() - 1]
            .chars()
            .all(|c| c.is_ascii_digit())
    {
        value[..open].trim_end()
    } else {
        value
    }
}

fn studio_album(formats: &[String]) -> bool {
    let labels: Vec<_> = formats.iter().map(|f| normalize_title(f)).collect();
    labels.iter().any(|l| l == "album")
        && ![
            "compilation",
            "live",
            "mixtape",
            "unofficial release",
            "bootleg",
            "dj mix",
            "single",
            "ep",
        ]
        .iter()
        .any(|marker| labels.iter().any(|l| l == marker))
}

/// Studio-album masters whose credited artist is exactly `artist`, oldest first.
fn discogs_albums_from(response: DiscogsSearch, artist: &str) -> Vec<DiscogsAlbum> {
    let wanted = normalize_title(artist);
    let mut albums: Vec<DiscogsAlbum> = vec![];
    for result in response.results {
        let Some((credited, title)) = result.title.split_once(" - ") else {
            continue;
        };
        if normalize_title(strip_numeric_suffix(credited)) != wanted
            || !studio_album(&result.format)
        {
            continue;
        }
        let key = normalize_title(title);
        if key.is_empty() || albums.iter().any(|a| normalize_title(&a.title) == key) {
            continue;
        }
        albums.push(DiscogsAlbum {
            id: result.id,
            title: title.trim().to_owned(),
            year: result.year,
        });
    }
    albums.sort_by(|a, b| a.year.cmp(&b.year).then(a.id.cmp(&b.id)));
    albums
}

pub(super) async fn discogs_albums(
    provider: &DiscoveryProvider,
    artist: &str,
) -> Result<Option<Data<Vec<DiscogsAlbum>>>, String> {
    let Some((credential, _)) = credentials::resolve(Source::Discogs)? else {
        return Ok(None);
    };
    let Some(secret) = credential.secret.as_ref() else {
        return Ok(None);
    };
    let authorization = zeroize::Zeroizing::new(format!(
        "Discogs key={}, secret={}",
        credential.key.as_str(),
        secret.as_str()
    ));
    let data = provider
        .get_with::<DiscogsSearch>(
            provider::DISCOGS,
            format!("discogs-albums:{}", normalize_title(artist)),
            DISCOGS_SEARCH_URL,
            &[
                ("artist", artist),
                ("type", "master"),
                ("format", "album"),
                ("per_page", "100"),
            ],
            &[("Authorization", authorization.as_str())],
            |_| Ok(()),
        )
        .await
        .map_err(|error| {
            if error.contains("HTTP 401") || error.contains("HTTP 403") {
                "Discogs rejected the key or secret. Check them under Sources.".to_owned()
            } else {
                error
            }
        })?;
    Ok(Some(Data {
        value: discogs_albums_from(data.value, artist),
        notice: data.notice,
    }))
}

// ---- Fanart.tv -----------------------------------------------------------

#[derive(Default, Deserialize, Serialize)]
pub(super) struct FanartArtist {
    #[serde(default)]
    artistthumb: Vec<FanartImage>,
    #[serde(default)]
    artistbackground: Vec<FanartImage>,
}

#[derive(Deserialize, Serialize)]
struct FanartImage {
    url: String,
    #[serde(default, deserialize_with = "flexible_f64")]
    likes: Option<f64>,
}

fn best_fanart_image(artist: FanartArtist) -> Option<String> {
    let mut images = if artist.artistthumb.is_empty() {
        artist.artistbackground
    } else {
        artist.artistthumb
    };
    images.retain(|image| image.url.starts_with("https://assets.fanart.tv/"));
    images.sort_by(|a, b| b.likes.unwrap_or(0.0).total_cmp(&a.likes.unwrap_or(0.0)));
    images.into_iter().next().map(|image| image.url)
}

/// Fanart.tv answers 404 for artists it has no art for; that is "no image", not an error.
pub(super) async fn fanart_image(
    provider: &DiscoveryProvider,
    artist_mbid: &str,
) -> Result<Option<String>, String> {
    let Some((credential, _)) = credentials::resolve(Source::Fanart)? else {
        return Ok(None);
    };
    let response = provider
        .get_with::<FanartArtist>(
            provider::FANART,
            format!("fanart:{artist_mbid}"),
            &format!("{FANART_URL}/{artist_mbid}"),
            &[],
            &[("api-key", credential.key.as_str())],
            |_| Ok(()),
        )
        .await;
    match response {
        Ok(data) => Ok(best_fanart_image(data.value)),
        Err(error) if error.contains("HTTP 404") => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lastfm_parses_scores_ids_and_drops_unusable_rows() {
        let response: LastFmSimilar = serde_json::from_str(
            r#"{"similarartists":{"artist":[
            {"name":"Michael Bolton","mbid":"3FFF1D2A-0000-4000-8000-000000000001","match":"1"},
            {"name":"No Id","mbid":"","match":"0.5"},
            {"name":"Zero","match":"0"},
            {"name":"Bad Id","mbid":"nope","match":0.25},
            {"name":"  ","match":"0.9"}
        ]}}"#,
        )
        .unwrap();
        let rows = lastfm_candidates(response);
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows[0].mbid.as_deref(),
            Some("3fff1d2a-0000-4000-8000-000000000001")
        );
        assert_eq!(rows[1].mbid, None);
        assert_eq!(rows[2].mbid, None);
        assert!((rows[2].score - 0.25).abs() < f64::EPSILON);
    }

    #[test]
    fn lastfm_errors_are_not_cached_but_unknown_artists_are_empty() {
        let parse = |json: &str| serde_json::from_str::<LastFmSimilar>(json).unwrap();
        assert!(check_lastfm(&parse(r#"{"error":6,"message":"not found"}"#)).is_ok());
        assert!(lastfm_candidates(parse(r#"{"error":6}"#)).is_empty());
        let key = check_lastfm(&parse(r#"{"error":10,"message":"Invalid API key"}"#)).unwrap_err();
        assert!(key.contains("API key"));
        assert!(check_lastfm(&parse(r#"{"error":29}"#))
            .unwrap_err()
            .contains("rate limit"));
        assert!(check_lastfm(&parse(r#"{"error":8}"#))
            .unwrap_err()
            .contains("code 8"));
    }

    #[test]
    fn discogs_keeps_exact_studio_masters_once_in_release_order() {
        let response: DiscogsSearch = serde_json::from_str(r#"{"results":[
            {"id":30,"title":"Richard Marx - Repeat Offender","year":"1989","format":["Vinyl","Album"]},
            {"id":10,"title":"Richard Marx - Richard Marx","year":"1987","format":["Album"]},
            {"id":11,"title":"Richard Marx - Richard Marx","year":"1987","format":["CD","Album"]},
            {"id":20,"title":"Richard Marx - Greatest Hits","year":1997,"format":["Album","Compilation"]},
            {"id":21,"title":"Richard Marx - Live","year":"1998","format":["Album","Live"]},
            {"id":22,"title":"Richard Marx - Single","year":"1990","format":["Single"]},
            {"id":40,"title":"Richard Marx (2) - Rush Street","year":"1991","format":["Album"]},
            {"id":50,"title":"Richard Marxx - Other","year":"1991","format":["Album"]},
            {"id":60,"title":"No separator","format":["Album"]}
        ]}"#).unwrap();
        let albums = discogs_albums_from(response, "Richard Marx");
        let titles: Vec<_> = albums.iter().map(|a| a.title.as_str()).collect();
        assert_eq!(titles, ["Richard Marx", "Repeat Offender", "Rush Street"]);
        assert_eq!(albums[0].year, Some(1987));
    }

    #[test]
    fn fanart_prefers_liked_thumbs_and_ignores_foreign_hosts() {
        let artist: FanartArtist = serde_json::from_str(
            r#"{"artistthumb":[
            {"url":"https://assets.fanart.tv/a.jpg","likes":"2"},
            {"url":"https://assets.fanart.tv/b.jpg","likes":"9"},
            {"url":"https://evil.example/c.jpg","likes":"99"}
        ]}"#,
        )
        .unwrap();
        assert_eq!(
            best_fanart_image(artist).as_deref(),
            Some("https://assets.fanart.tv/b.jpg")
        );
        assert_eq!(best_fanart_image(FanartArtist::default()), None);
    }
}
