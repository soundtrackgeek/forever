use super::{
    app_settings::Settings,
    diagnostics::{self, CrashReport, Diagnostics},
    ConnectionManager,
};
use serde_json::{json, Value};
use std::{
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    path::Path,
};
use tauri::State;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[tauri::command]
pub async fn diagnostics_export(
    manager: State<'_, ConnectionManager>,
    path: String,
) -> Result<(), String> {
    let diagnostics = manager.diagnostic_logger();
    let settings = manager.settings_store().get();
    let config = manager
        .settings_store()
        .file()
        .path()
        .parent()
        .ok_or("Missing settings folder.")?
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        export(&diagnostics, &settings, &config, Path::new(&path))
    })
    .await
    .map_err(|_| "The diagnostics export could not finish.".to_owned())?
}

fn settings_summary(settings: &Settings) -> Value {
    // Explicit fields: adding a preference must never silently expand the privacy boundary.
    json!({
        "schemaVersion": settings.version,
        "connection": settings.connection.as_ref().map(|c| json!({
            "configured": true, "serverPort": c.server_port, "listenPort": c.listen_port,
            "autoConnect": c.auto_connect, "automaticPortMapping": c.automatic_port_mapping,
            "allowDistributedChildren": c.allow_distributed_children,
        })),
        "transfers": {
            "maxConcurrentDownloads": settings.transfers.max_concurrent_downloads,
            "relaySuggestionMinutes": settings.transfers.relay_suggestion_minutes,
            "soundcheckEnabled": settings.transfers.soundcheck_enabled,
        },
        "sharing": {
            "uploadSlots": settings.sharing.upload_slots,
            "rootCount": settings.sharing.roots.len(),
            "maxFilesPerUser": settings.sharing.upload_policy.max_files_per_user,
            "maxMegabytesPerUser": settings.sharing.upload_policy.max_megabytes_per_user,
            "prioritizeFavorites": settings.sharing.upload_policy.prioritize_favorites,
            "prioritizePrivileged": settings.sharing.upload_policy.prioritize_privileged,
        },
        "wantedIntervalMinutes": settings.wanted.interval_minutes,
        "archiveConfigured": settings.archive_database_path.is_some(),
        "preferences": {
            "updateCheckIntervalMinutes": settings.preferences.update_check_interval_minutes,
            "messageNotificationsEnabled": settings.preferences.message_notifications_enabled,
            "roomNotificationsEnabled": settings.preferences.room_notifications_enabled,
            "musicBrainzFallbackTrackCount": settings.preferences.music_brainz_fallback_track_count,
        },
        "pinnedSearchCount": settings.dial_memory.pinned.len(),
        "recentSearchCount": settings.dial_memory.recent.len(),
    })
}

fn safe_record(value: &Value) -> Option<Value> {
    let fields = value.get("fields")?;
    Some(json!({
        "timestampMs": fields.get("timestamp_ms")?.as_u64()?,
        "level": diagnostics::safe_level(value.get("level")?.as_str()?),
        "event": diagnostics::safe_event(fields.get("event")?.as_str()?),
    }))
}

fn crash_summary(report: CrashReport) -> Value {
    // Reconstruct, never copy the report's bytes or unknown string values.
    let version = report.app_version.split('.').collect::<Vec<_>>();
    let version = if version.len() == 3
        && version
            .iter()
            .all(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
    {
        report.app_version.as_str()
    } else {
        "unknown"
    };
    let source = match report.source_file.as_str() {
        "lib.rs" | "main.rs" | "service.rs" | "diagnostics.rs" | "mod.rs" | "store.rs"
        | "app_settings.rs" | "settings.rs" | "downloads.rs" | "uploads.rs" | "protocol.rs"
        | "reachability.rs" | "local_shares.rs" | "search.rs" | "rooms.rs" | "messages.rs"
        | "people.rs" | "soundcheck.rs" | "wanted.rs" | "radar.rs" => report.source_file.as_str(),
        _ => "other source file",
    };
    json!({ "schemaVersion": 1, "timestampMs": report.timestamp_ms,
        "appVersion": version, "sourceFile": source, "line": report.line, "column": report.column,
        "os": match report.os.as_str() { "windows" => "windows", "macos" => "macos", "linux" => "linux", _ => "other" },
        "architecture": match report.architecture.as_str() { "x86_64" => "x86_64", "aarch64" => "aarch64", "x86" => "x86", _ => "other" },
    })
}

fn export(
    diagnostics: &Diagnostics,
    settings: &Settings,
    config: &Path,
    path: &Path,
) -> Result<(), String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
    {
        return Err("Choose a .zip diagnostics file.".into());
    }
    let parent = path
        .parent()
        .ok_or("Choose an export folder.")?
        .canonicalize()
        .map_err(|_| "The export folder is unavailable.")?;
    let config = config
        .canonicalize()
        .map_err(|_| "The settings folder is unavailable.")?;
    if parent.starts_with(config) {
        return Err("Choose an export folder outside Forever's configuration folder.".into());
    }
    if fs::symlink_metadata(path).is_ok_and(|m| !m.file_type().is_file()) {
        return Err("Choose a regular .zip file for the export.".into());
    }
    write_bundle(diagnostics, settings, &parent, path).map_err(|_| {
        "Could not write diagnostics. Check the destination folder and available disk space."
            .to_owned()
    })?;
    diagnostics.record(
        "info",
        "diagnostics_exported",
        "A diagnostics bundle was saved locally.",
    );
    Ok(())
}

fn write_bundle(
    diagnostics: &Diagnostics,
    settings: &Settings,
    parent: &Path,
    path: &Path,
) -> io::Result<()> {
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    let mut zip = ZipWriter::new(temporary.as_file_mut());
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("settings-summary.json", options)?;
    serde_json::to_writer_pretty(&mut zip, &settings_summary(settings))?;
    let mut skipped_records = 0u64;
    let mut skipped_files = 0u64;
    let mut truncated_files = 0u64;
    let mut log_count = 0u64;
    let paths = diagnostics::log_files(diagnostics.path()).unwrap_or_else(|_| {
        // A diagnostics failure is exactly when an in-memory support bundle is useful.
        skipped_files += 1;
        Vec::new()
    });
    for path in paths.iter().rev().take(diagnostics::MAX_LOG_FILES).rev() {
        let Ok(file) = fs::File::open(path) else {
            skipped_files += 1;
            continue;
        };
        let length = file.metadata()?.len();
        if length > diagnostics::MAX_LOG_BYTES {
            truncated_files += 1;
        }
        zip.start_file(
            format!(
                "logs/{}",
                path.file_name().unwrap_or_default().to_string_lossy()
            ),
            options,
        )?;
        log_count += 1;
        // Bounded total read, including malformed input with no newlines.
        for line in BufReader::new(file.take(diagnostics::MAX_LOG_BYTES)).split(b'\n') {
            let line = line?;
            if line.is_empty() {
                continue;
            }
            let record = serde_json::from_slice::<Value>(&line)
                .ok()
                .and_then(|v| safe_record(&v));
            if let Some(record) = record {
                serde_json::to_writer(&mut zip, &record)?;
                zip.write_all(b"\n")?;
            } else {
                skipped_records += 1;
            }
        }
    }
    zip.start_file("recent-events.json", options)?;
    let recent: Vec<_> = diagnostics
        .recent()
        .iter()
        .map(|e| {
            json!({
                "timestampMs": e.timestamp_ms, "level": diagnostics::safe_level(&e.level),
                "event": diagnostics::safe_event(&e.event),
            })
        })
        .collect();
    serde_json::to_writer_pretty(&mut zip, &recent)?;

    let crash_path = diagnostics.path().join("crash-latest.json");
    let mut crash_included = false;
    if let Ok(metadata) = fs::symlink_metadata(&crash_path) {
        if metadata.file_type().is_file() && metadata.len() <= 16 * 1024 {
            let report = fs::File::open(crash_path).ok().and_then(|file| {
                serde_json::from_reader::<_, CrashReport>(file.take(16 * 1024)).ok()
            });
            if let Some(report) = report {
                zip.start_file("crash-latest.json", options)?;
                serde_json::to_writer_pretty(&mut zip, &crash_summary(report))?;
                crash_included = true;
            } else {
                skipped_files += 1;
            }
        } else {
            skipped_files += 1;
        }
    }
    zip.start_file("manifest.json", options)?;
    serde_json::to_writer_pretty(
        &mut zip,
        &json!({
            "schemaVersion": 1, "appVersion": env!("CARGO_PKG_VERSION"), "tauriVersion": tauri::VERSION,
            "os": std::env::consts::OS, "architecture": std::env::consts::ARCH,
            "exportedAtMs": diagnostics::timestamp_ms(), "logFiles": log_count,
            "skippedRecords": skipped_records, "skippedFiles": skipped_files,
            "truncatedFiles": truncated_files, "crashReportIncluded": crash_included,
            "logging": diagnostics.health(),
            "privacy": "Event codes, severity and timestamps only. Free-form messages, credentials, usernames, hosts, IPs, paths, searches, messages and transfer history are excluded. Legacy connection.log is excluded. Nothing is uploaded.",
        }),
    )?;
    zip.finish()?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod tests;
