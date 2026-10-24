use super::super::settings::ConnectionProfile;
use super::*;
use std::collections::HashMap;

fn contents(path: &Path) -> HashMap<String, String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut entry = zip.by_index(i).unwrap();
            let name = entry.name().to_owned();
            let mut text = String::new();
            entry.read_to_string(&mut text).unwrap();
            (name, text)
        })
        .collect()
}

#[test]
fn unavailable_logging_still_exports_recent_events_and_settings() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    fs::create_dir(&config).unwrap();
    fs::write(config.join("logs"), b"preserve").unwrap();
    let diagnostics = Diagnostics::new(config.join("logs"));
    diagnostics.record("info", "connected", "Connected.");
    let output = dir.path().join("report.zip");
    export(&diagnostics, &Settings::default(), &config, &output).unwrap();
    let files = contents(&output);
    let manifest: Value = serde_json::from_str(&files["manifest.json"]).unwrap();
    assert_eq!(manifest["logging"]["writeFailed"], true);
    assert_eq!(manifest["skippedFiles"], 1);
    assert!(files["recent-events.json"].contains("connected"));
    assert_eq!(fs::read(config.join("logs")).unwrap(), b"preserve");
}

#[cfg(windows)]
#[test]
fn failed_atomic_replacement_preserves_previous_zip_and_cleans_temporary_file() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    let diagnostics = Diagnostics::new(config.join("logs"));
    let output = dir.path().join("report.zip");
    fs::write(&output, b"previous report").unwrap();
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&output)
        .unwrap();
    assert!(export(&diagnostics, &Settings::default(), &config, &output).is_err());
    drop(locked);
    assert_eq!(fs::read(output).unwrap(), b"previous report");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[test]
fn zip_contains_only_safe_settings_events_and_crash_fields() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    let diagnostics = Diagnostics::new(config.join("logs"));
    let mut profile = ConnectionProfile::suggested(Path::new("C:\\PRIVATE_FOLDER"));
    profile.username = "PRIVATE_USERNAME".into();
    profile.server_host = "192.0.2.11".into();
    let settings = Settings {
        connection: Some(profile),
        archive_database_path: Some("C:\\PRIVATE_ARCHIVE".into()),
        ..Settings::default()
    };
    diagnostics.record(
        "warn",
        "connect_failed",
        "UnlabelledPRIVATE_PASSWORD 192.0.2.11 [2001:db8::42]",
    );
    let log = diagnostics::log_files(diagnostics.path())
        .unwrap()
        .pop()
        .unwrap();
    let mut file = fs::OpenOptions::new().append(true).open(log).unwrap();
    writeln!(
        file,
        "{}",
        json!({"level": "PRIVATE_LEVEL", "fields": {"timestamp_ms": 123,
        "event": "PRIVATE_EVENT", "message": "PRIVATE_PASSWORD"}, "unknown": "PRIVATE_OTHER"})
    )
    .unwrap();
    writeln!(file, "malformed PRIVATE_SECRET").unwrap();
    fs::write(
        diagnostics.path().join("connection.log"),
        "legacy PRIVATE_SECRET",
    )
    .unwrap();
    fs::write(diagnostics.path().join("arbitrary.json"), "PRIVATE_SECRET").unwrap();
    fs::write(
        diagnostics.path().join("crash-latest.json"),
        serde_json::to_vec(&CrashReport {
            schema_version: 1,
            timestamp_ms: 42,
            app_version: "0.0.67".into(),
            os: "windows".into(),
            architecture: "x86_64".into(),
            source_file: "C:\\PRIVATE_SOURCE".into(),
            line: 12,
            column: 4,
        })
        .unwrap(),
    )
    .unwrap();
    let output = dir.path().join("report.zip");
    fs::write(&output, "previous export").unwrap();
    export(&diagnostics, &settings, &config, &output).unwrap();
    let files = contents(&output);
    assert_eq!(files.len(), 5);
    let combined = files.values().cloned().collect::<Vec<_>>().join("\n");
    assert!(!combined.contains("PRIVATE"));
    assert!(!combined.contains("192.0.2.11"));
    assert!(!combined.contains("2001:db8"));
    assert!(combined.contains("connect_failed"));
    assert!(combined.contains("diagnostic_event"));
    assert!(files["settings-summary.json"].contains("maxConcurrentDownloads"));
    let manifest: Value = serde_json::from_str(&files["manifest.json"]).unwrap();
    assert_eq!(manifest["skippedRecords"], 1);
    assert_eq!(manifest["crashReportIncluded"], true);
    assert_eq!(
        fs::read_to_string(diagnostics.path().join("connection.log")).unwrap(),
        "legacy PRIVATE_SECRET"
    );
}

#[test]
fn rejects_invalid_destinations_and_preserves_existing_files_on_failure() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    let diagnostics = Diagnostics::new(config.join("logs"));
    for path in [
        Path::new("relative.zip").to_owned(),
        dir.path().join("wrong.json"),
        config.join("data.zip"),
        config.join("logs").join("data.zip"),
        dir.path().join("missing").join("file.zip"),
    ] {
        assert!(export(&diagnostics, &Settings::default(), &config, &path).is_err());
        assert!(!path.exists());
    }
    let destination = dir.path().join("old.zip");
    fs::write(&destination, b"keep").unwrap();
    // Fail bundle construction before publishing it.
    let broken = dir.path().join("missing-logs");
    assert!(write_bundle(&diagnostics, &Settings::default(), &broken, &destination).is_err());
    assert_eq!(fs::read(destination).unwrap(), b"keep");
}

#[test]
fn skips_corrupt_crash_reports_and_caps_oversized_log_reads() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    let diagnostics = Diagnostics::new(config.join("logs"));
    let path = diagnostics::log_files(diagnostics.path())
        .unwrap()
        .pop()
        .unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_len(diagnostics::MAX_LOG_BYTES + 4096)
        .unwrap();
    fs::write(
        diagnostics.path().join("crash-latest.json"),
        b"invalid SECRET",
    )
    .unwrap();
    let output = dir.path().join("export.zip");
    export(&diagnostics, &Settings::default(), &config, &output).unwrap();
    let files = contents(&output);
    let manifest: Value = serde_json::from_str(&files["manifest.json"]).unwrap();
    assert_eq!(manifest["truncatedFiles"], 1);
    assert_eq!(manifest["skippedFiles"], 1);
    assert!(!files.contains_key("crash-latest.json"));
}
