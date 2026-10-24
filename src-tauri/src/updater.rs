//! Channel selection stays native: the webview cannot supply an updater URL or key.
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

impl UpdateChannel {
    fn accepts(self, current: &semver::Version, available: &semver::Version) -> bool {
        available > current && (self == Self::Beta || available.pre.is_empty())
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => {
                "https://github.com/soundtrackgeek/forever/releases/latest/download/latest.json"
            }
            Self::Beta => {
                "https://github.com/soundtrackgeek/forever/releases/download/beta/latest.json"
            }
        }
    }
}

// The official JS Update resource handles download, signature verification and install.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn updater_check(
    webview: Webview,
    channel: UpdateChannel,
) -> Result<Option<UpdateMetadata>, String> {
    let updater = webview
        .updater_builder()
        .endpoints(vec![channel
            .endpoint()
            .parse()
            .map_err(|e| format!("Invalid update endpoint: {e}"))?])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(12))
        // Stable never offers prereleases, even if its feed is published incorrectly.
        // Both channels only move forward; leaving Beta never silently downgrades data.
        .version_comparator(move |current, release| channel.accepts(&current, &release.version))
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update
            .date
            .map(|date| date.format(&time::format_description::well_known::Rfc3339))
            .transpose()
            .map_err(|e| e.to_string())?,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(Some(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_never_downgrade_and_stable_never_accepts_prereleases() {
        for (channel, current, available, expected) in [
            (UpdateChannel::Stable, "0.0.72", "0.0.73-beta.1", false),
            (UpdateChannel::Beta, "0.0.72", "0.0.73-beta.1", true),
            (UpdateChannel::Beta, "0.0.73-beta.2", "0.0.73-beta.10", true),
            (UpdateChannel::Stable, "0.0.73-beta.1", "0.0.72", false),
            (UpdateChannel::Stable, "0.0.73-beta.1", "0.0.73", true),
            (UpdateChannel::Beta, "0.0.73-beta.1", "0.0.73", true),
            (UpdateChannel::Beta, "0.0.73", "0.0.73", false),
        ] {
            assert_eq!(
                channel.accepts(&current.parse().unwrap(), &available.parse().unwrap()),
                expected
            );
        }
    }

    #[test]
    fn channels_are_closed_and_stable_keeps_the_legacy_endpoint() {
        assert!(serde_json::from_str::<UpdateChannel>("\"nightly\"").is_err());
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["plugins"]["updater"]["endpoints"][0],
            UpdateChannel::Stable.endpoint()
        );
        assert_ne!(
            UpdateChannel::Stable.endpoint(),
            UpdateChannel::Beta.endpoint()
        );
        assert!(UpdateChannel::Beta
            .endpoint()
            .ends_with("/beta/latest.json"));
    }
}
