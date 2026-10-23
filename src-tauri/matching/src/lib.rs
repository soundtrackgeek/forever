//! Shared matching policy for background Wanted checks and foreground review.
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

pub fn words(value: &str) -> Vec<String> {
    let mut text = String::new();
    for c in value
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
    {
        match c {
            '&' => text.push_str(" and "),
            'ø' => text.push('o'),
            'ł' => text.push('l'),
            'æ' => text.push_str("ae"),
            'œ' => text.push_str("oe"),
            'ß' => text.push_str("ss"),
            c if c.is_alphanumeric() => text.push(c),
            _ => text.push(' '),
        }
    }
    text.split_whitespace().map(str::to_owned).collect()
}

pub fn normalize_title(value: String) -> String {
    words(&value).join(" ")
}

fn basename(value: &str) -> &str {
    value
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or(value)
}

pub fn normalize_track_title(value: &str, artist: &str) -> String {
    static NUMBER: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)^(?:(?:disc|disk|cd)\s*\d+[\s._-]*)?(?:\d{1,3}\s*[-._]\s*\d{1,3}|\d{1,3})(?:\s*[-._)]\s*|\s+)").unwrap()
    });
    static REMASTER: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)\s*[\(\[](?:(?:19|20)\d{2}\s+remaster(?:ed)?|remaster(?:ed)?(?:\s+(?:19|20)\d{2})?)[\)\]]\s*$").unwrap()
    });
    let title = basename(value);
    // Strip audio extensions only: punctuation in an official title is meaningful.
    let title = title
        .rsplit_once('.')
        .filter(|(_, ext)| is_audio(ext))
        .map_or(title, |(stem, _)| stem);
    let title = NUMBER.replace(title, "");
    let title = normalize_title(REMASTER.replace(&title, "").into_owned());
    let artist = normalize_title(artist.to_owned());
    title
        .strip_prefix(&format!("{artist} "))
        .filter(|_| !artist.is_empty())
        .unwrap_or(&title)
        .to_owned()
}

pub fn is_audio(format: &str) -> bool {
    matches!(
        format.to_ascii_uppercase().as_str(),
        "AAC"
            | "AIF"
            | "AIFF"
            | "ALAC"
            | "APE"
            | "CAF"
            | "FLAC"
            | "M4A"
            | "MP3"
            | "OGA"
            | "OGG"
            | "OPUS"
            | "WAV"
            | "WMA"
            | "WV"
    )
}
pub fn is_lossless(format: &str) -> bool {
    matches!(
        format.to_ascii_uppercase().as_str(),
        "FLAC" | "ALAC" | "WAV" | "AIF" | "AIFF" | "APE" | "WV"
    )
}
fn format_rank(format: &str) -> u32 {
    match format.to_ascii_uppercase().as_str() {
        "FLAC" => 10,
        "ALAC" => 9,
        "WAV" | "AIFF" | "AIF" => 8,
        "APE" | "WV" => 7,
        "MP3" => 5,
        "M4A" | "AAC" => 4,
        "OGG" | "OGA" | "OPUS" => 3,
        "WMA" => 2,
        _ => 1,
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SourceTitle {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleMatch {
    pub official: AlbumTrack,
    pub source_name: String,
    pub similarity: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracklistConfidence {
    pub state: String,
    pub label: String,
    pub summary: String,
    pub matched_count: usize,
    pub official_count: usize,
    pub source_count: usize,
    pub missing_tracks: Vec<AlbumTrack>,
    pub extra_source_names: Vec<String>,
    pub matches: Vec<TitleMatch>,
    pub safe_to_recommend: bool,
    pub score: u32,
}

fn similarity(left: &str, right: &str) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    if left == right {
        return 1.0;
    }
    let (short, long) = if left.chars().count() <= right.chars().count() {
        (left, right)
    } else {
        (right, left)
    };
    if short.chars().count() >= 5 && long.contains(short) {
        return 0.92;
    }
    let lt: HashSet<_> = left.split_whitespace().collect();
    let rt: HashSet<_> = right.split_whitespace().collect();
    let token_score = lt.intersection(&rt).count() as f64 / lt.len().max(rt.len()).max(1) as f64;
    let bigrams = |s: &str| {
        let chars: Vec<_> = s.chars().collect();
        if chars.len() < 2 {
            vec![s.to_owned()]
        } else {
            chars
                .windows(2)
                .map(|pair| pair.iter().collect::<String>())
                .collect()
        }
    };
    let lb = bigrams(left);
    let rb = bigrams(right);
    let mut available = HashMap::new();
    for pair in &rb {
        *available.entry(pair).or_insert(0) += 1;
    }
    let mut shared = 0;
    for pair in &lb {
        if let Some(count) = available.get_mut(pair) {
            if *count > 0 {
                shared += 1;
                *count -= 1;
            }
        }
    }
    token_score * 0.4 + (2 * shared) as f64 / (lb.len() + rb.len()).max(1) as f64 * 0.6
}

pub fn tracklist_confidence(
    source_titles: Vec<SourceTitle>,
    official_tracks: Vec<AlbumTrack>,
    artist: String,
) -> TracklistConfidence {
    confidence(&source_titles, &official_tracks, &artist)
}

pub fn confidence(
    sources: &[SourceTitle],
    official: &[AlbumTrack],
    artist: &str,
) -> TracklistConfidence {
    if official.is_empty() {
        return TracklistConfidence {
            state: "unavailable".into(),
            label: "Track count only".into(),
            summary: "Official tracklist unavailable".into(),
            matched_count: 0,
            official_count: 0,
            source_count: sources.len(),
            missing_tracks: vec![],
            extra_source_names: vec![],
            matches: vec![],
            safe_to_recommend: true,
            score: 0,
        };
    }
    let keys: Vec<_> = official
        .iter()
        .map(|track| normalize_track_title(&track.title, ""))
        .collect();
    let mut candidates = vec![];
    for (si, source) in sources.iter().enumerate() {
        let key = normalize_track_title(&source.name, artist);
        for (oi, other) in keys.iter().enumerate() {
            let score = similarity(&key, other);
            if score >= 0.78 {
                candidates.push((si, oi, score));
            }
        }
    }
    candidates.sort_by(|a, b| {
        b.2.total_cmp(&a.2)
            .then_with(|| sources[a.0].name.cmp(&sources[b.0].name))
            .then(a.1.cmp(&b.1))
            .then_with(|| sources[a.0].id.cmp(&sources[b.0].id))
    });
    let mut used_sources = HashSet::new();
    let mut used_official = HashSet::new();
    let mut matches = vec![];
    for (si, oi, similarity) in candidates {
        if used_sources.contains(&sources[si].id) || used_official.contains(&oi) {
            continue;
        }
        used_sources.insert(sources[si].id.clone());
        used_official.insert(oi);
        matches.push(TitleMatch {
            official: official[oi].clone(),
            source_name: basename(&sources[si].name).into(),
            similarity,
        });
    }
    matches.sort_by_key(|m| m.official.position);
    let missing_tracks: Vec<_> = official
        .iter()
        .enumerate()
        .filter(|(i, _)| !used_official.contains(i))
        .map(|(_, t)| t.clone())
        .collect();
    let extra_source_names: Vec<_> = sources
        .iter()
        .filter(|s| !used_sources.contains(&s.id))
        .map(|s| basename(&s.name).to_owned())
        .collect();
    let count = matches.len();
    let extras = extra_source_names.len();
    let state = if count == official.len() {
        if extras == 0 {
            "exact"
        } else {
            "completeWithExtras"
        }
    } else if count * 2 < official.len() || count == 0 {
        "unclear"
    } else {
        "partial"
    };
    let label = match state {
        "exact" => "Exact tracklist".into(),
        "completeWithExtras" => format!("Complete · {extras} extra"),
        "partial" => format!("{} missing", missing_tracks.len()),
        _ => "Unclear match".into(),
    };
    let mut summary = format!("{count}/{} titles matched", official.len());
    if state == "completeWithExtras" {
        summary.push_str(&format!(" · {extras} extra"));
    }
    let score = match state {
        "exact" => 6000,
        "completeWithExtras" => 5400u32.saturating_sub(extras as u32 * 60).max(4500),
        "partial" => (count as f64 / official.len() as f64 * 2500.0).round() as u32,
        _ => 0,
    };
    TracklistConfidence {
        state: state.into(),
        label,
        summary,
        matched_count: count,
        official_count: official.len(),
        source_count: sources.len(),
        missing_tracks,
        extra_source_names,
        matches,
        safe_to_recommend: count == official.len(),
        score,
    }
}

#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingTrack {
    pub id: String,
    pub name: String,
    pub format: String,
    pub bitrate: Option<u32>,
}

#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingSource {
    pub id: String,
    pub owner: String,
    pub folder: String,
    pub tracks: Vec<RankingTrack>,
    pub slot_free: bool,
    pub average_speed: u32,
    pub queue_length: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedSource {
    pub source_id: String,
    pub eligible: bool,
    pub score: u32,
    pub format: String,
    pub minimum_bitrate_kbps: Option<u32>,
    pub reason: String,
    pub tracklist_confidence: TracklistConfidence,
}

pub fn rank_sources(
    sources: &[RankingSource],
    preferences: &WantedPreferences,
    official: &[AlbumTrack],
    artist: &str,
) -> Vec<RankedSource> {
    let mut ranked: Vec<_> = sources
        .iter()
        .map(|source| {
            let titles = source
                .tracks
                .iter()
                .map(|t| SourceTitle {
                    id: t.id.clone(),
                    name: t.name.clone(),
                })
                .collect::<Vec<_>>();
            let confidence = confidence(&titles, official, artist);
            let formats: HashSet<_> = source
                .tracks
                .iter()
                .map(|t| t.format.to_ascii_uppercase())
                .collect();
            let format = formats
                .iter()
                .min_by(|a, b| format_rank(b).cmp(&format_rank(a)).then(a.cmp(b)))
                .cloned()
                .unwrap_or_else(|| "Unknown".into());
            let lossless = formats.iter().any(|f| is_lossless(f));
            let mp3 = !formats.is_empty() && formats.iter().all(|f| f == "MP3");
            let lossy: Vec<_> = source
                .tracks
                .iter()
                .filter(|t| !is_lossless(&t.format))
                .collect();
            let minimum_bitrate_kbps = if lossy.iter().any(|t| t.bitrate.is_none_or(|b| b == 0)) {
                None
            } else {
                lossy.iter().filter_map(|t| t.bitrate).min()
            };
            let enough = preferences
                .minimum_track_count
                .is_none_or(|m| source.tracks.len() >= m as usize);
            let allowed = match preferences.format_preference {
                WantedFormatPreference::LosslessOnly => lossless,
                WantedFormatPreference::Mp3Only => mp3,
                _ => true,
            };
            let bitrate = lossless
                || preferences
                    .minimum_bitrate_kbps
                    .is_none_or(|m| minimum_bitrate_kbps.is_some_and(|b| b >= m));
            let bonus = if (preferences.format_preference != WantedFormatPreference::Any
                && lossless)
                || (preferences.format_preference == WantedFormatPreference::Mp3Only && mp3)
            {
                500
            } else {
                0
            };
            let score = bonus
                + confidence.score
                + format_rank(&format) * 20
                + source.tracks.len() as u32 * 30
                + u32::from(source.slot_free) * 180
                + (source.average_speed / 100_000).min(120)
                + 100u32.saturating_sub(source.queue_length.min(20) * 5);
            let reason = if !enough {
                format!("Needs {} tracks", preferences.minimum_track_count.unwrap())
            } else if !confidence.safe_to_recommend {
                if confidence.state == "partial" {
                    format!(
                        "{} official tracks missing",
                        confidence.missing_tracks.len()
                    )
                } else {
                    "Track titles do not line up".into()
                }
            } else if !allowed {
                if preferences.format_preference == WantedFormatPreference::Mp3Only {
                    "MP3 required".into()
                } else {
                    "Lossless required".into()
                }
            } else if !bitrate {
                format!("{} kbps minimum", preferences.minimum_bitrate_kbps.unwrap())
            } else {
                format!(
                    "{} · {}",
                    if confidence.state == "unavailable" {
                        "Matches"
                    } else {
                        &confidence.label
                    },
                    if source.slot_free {
                        "free slot".into()
                    } else {
                        format!("{} queued", source.queue_length)
                    }
                )
            };
            (
                source,
                RankedSource {
                    source_id: source.id.clone(),
                    eligible: enough && allowed && bitrate && confidence.safe_to_recommend,
                    score,
                    format,
                    minimum_bitrate_kbps,
                    reason,
                    tracklist_confidence: confidence,
                },
            )
        })
        .collect();
    ranked.sort_by(|(a, ar), (b, br)| {
        br.eligible
            .cmp(&ar.eligible)
            .then(br.score.cmp(&ar.score))
            .then(b.tracks.len().cmp(&a.tracks.len()))
            .then(b.average_speed.cmp(&a.average_speed))
            .then_with(|| a.owner.cmp(&b.owner))
            .then_with(|| a.folder.cmp(&b.folder))
            .then_with(|| a.id.cmp(&b.id))
    });
    ranked.into_iter().map(|(_, r)| r).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    pub fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../fixtures/matching.json")).unwrap()
    }

    #[test]
    fn shared_normalization_fixtures() {
        let fixture = fixture();
        for case in fixture["normalization"].as_array().unwrap() {
            assert_eq!(
                normalize_title(case["input"].as_str().unwrap().into()),
                case["expected"].as_str().unwrap()
            );
        }
        for case in fixture["trackTitles"].as_array().unwrap() {
            assert_eq!(
                normalize_track_title(
                    case["input"].as_str().unwrap(),
                    case["artist"].as_str().unwrap()
                ),
                case["expected"].as_str().unwrap()
            );
        }
    }

    #[test]
    fn shared_ranking_fixtures_are_order_independent() {
        for case in fixture()["ranking"].as_array().unwrap() {
            let mut sources: Vec<RankingSource> =
                serde_json::from_value(case["sources"].clone()).unwrap();
            let preferences = serde_json::from_value(case["preferences"].clone()).unwrap();
            let tracks: Vec<AlbumTrack> =
                serde_json::from_value(case["officialTracks"].clone()).unwrap();
            let rank = |s: &[RankingSource]| {
                rank_sources(s, &preferences, &tracks, case["artist"].as_str().unwrap())
            };
            let ranked = rank(&sources);
            assert_eq!(
                serde_json::json!(ranked.iter().map(|r| &r.source_id).collect::<Vec<_>>()),
                case["ids"],
                "{}",
                case["name"]
            );
            assert_eq!(
                serde_json::json!(ranked.iter().map(|r| r.eligible).collect::<Vec<_>>()),
                case["eligible"],
                "{}",
                case["name"]
            );
            assert_eq!(
                serde_json::json!(ranked.iter().map(|r| r.score).collect::<Vec<_>>()),
                case["scores"],
                "{}",
                case["name"]
            );
            sources.reverse();
            for source in &mut sources {
                source.tracks.reverse();
            }
            let reversed = rank(&sources);
            assert_eq!(
                ranked
                    .iter()
                    .map(|r| (&r.source_id, r.score, r.eligible))
                    .collect::<Vec<_>>(),
                reversed
                    .iter()
                    .map(|r| (&r.source_id, r.score, r.eligible))
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn tracklists_cover_missing_extras_unavailable_and_duplicate_titles() {
        let fixture = fixture();
        let case = &fixture["ranking"][0];
        let sources: Vec<RankingSource> = serde_json::from_value(case["sources"].clone()).unwrap();
        let preferences = serde_json::from_value(case["preferences"].clone()).unwrap();
        let tracks: Vec<AlbumTrack> =
            serde_json::from_value(case["officialTracks"].clone()).unwrap();
        let ranked = rank_sources(&sources, &preferences, &tracks, "INXS");
        assert_eq!(
            ranked
                .iter()
                .map(|r| r.tracklist_confidence.state.as_str())
                .collect::<Vec<_>>(),
            ["exact", "completeWithExtras", "partial", "unclear"]
        );
        assert_eq!(
            ranked[1].tracklist_confidence.extra_source_names,
            ["Bonus.flac"]
        );
        assert_eq!(
            ranked[2].tracklist_confidence.missing_tracks[0].title,
            "Melting in the Sun"
        );
        let titles = vec![
            SourceTitle {
                id: "same-file".into(),
                name: "Original Sin.flac".into()
            };
            2
        ];
        let mut repeated = vec![tracks[0].clone(); 2];
        repeated[1].position = 2;
        assert_eq!(confidence(&titles, &repeated, "").matched_count, 1);
        assert_eq!(confidence(&titles, &[], "").state, "unavailable");
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WantedFormatPreference {
    Any,
    #[default]
    PreferLossless,
    LosslessOnly,
    Mp3Only,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedPreferences {
    pub format_preference: WantedFormatPreference,
    pub minimum_bitrate_kbps: Option<u32>,
    pub minimum_track_count: Option<u32>,
}

impl Default for WantedPreferences {
    fn default() -> Self {
        Self {
            format_preference: WantedFormatPreference::PreferLossless,
            minimum_bitrate_kbps: Some(320),
            minimum_track_count: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumTrack {
    pub position: u32,
    pub disc_number: u32,
    pub disc_position: u32,
    pub title: String,
    pub duration_ms: Option<u32>,
}
