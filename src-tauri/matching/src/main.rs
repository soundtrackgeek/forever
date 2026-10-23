//! Local development/test bridge. No network, catalog or filesystem access.
use forever_matching::*;
use serde::Deserialize;
use std::io::{self, Read};

#[derive(Deserialize)]
struct Request {
    command: String,
    args: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankArgs {
    sources: Vec<RankingSource>,
    preferences: WantedPreferences,
    official_tracks: Vec<AlbumTrack>,
    artist: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfidenceArgs {
    source_titles: Vec<SourceTitle>,
    official_tracks: Vec<AlbumTrack>,
    artist: String,
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin()
        .take(8 * 1024 * 1024)
        .read_to_string(&mut input)?;
    let request: Request = serde_json::from_str(&input)?;
    let value = match request.command.as_str() {
        "rank_album_sources" => {
            let a: RankArgs = serde_json::from_value(request.args)?;
            serde_json::to_value(rank_sources(
                &a.sources,
                &a.preferences,
                &a.official_tracks,
                &a.artist,
            ))?
        }
        "tracklist_confidence" => {
            let a: ConfidenceArgs = serde_json::from_value(request.args)?;
            serde_json::to_value(confidence(&a.source_titles, &a.official_tracks, &a.artist))?
        }
        "normalize_title" => serde_json::to_value(normalize_title(
            request.args["value"]
                .as_str()
                .ok_or("Missing value")?
                .into(),
        ))?,
        _ => return Err("Unknown matching command".into()),
    };
    println!("{}", serde_json::to_string(&value)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
