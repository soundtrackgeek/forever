use super::*;

#[test]
fn unavailable_log_directory_does_not_block_startup_or_recent_activity() {
    let dir = tempfile::tempdir().unwrap();
    let blocked = dir.path().join("blocked");
    std::fs::write(&blocked, b"preserve").unwrap();
    let diagnostics = Diagnostics::new(blocked.join("logs"));
    diagnostics.record("info", "connected", "Connected.");
    assert!(diagnostics.health().write_failed);
    assert!(diagnostics.recent().iter().any(|e| e.event == "connected"));
    assert_eq!(
        diagnostics.recent().last().unwrap().event,
        "log_write_failed"
    );
    assert_eq!(std::fs::read(blocked).unwrap(), b"preserve");
}

#[test]
fn retains_seven_daily_logs_across_restarts_without_touching_legacy_or_other_files() {
    let dir = tempfile::tempdir().unwrap();
    for day in 1..=10 {
        std::fs::write(
            dir.path()
                .join(format!("connection.2020-01-{day:02}.jsonl")),
            b"old\n",
        )
        .unwrap();
    }
    for name in ["connection.log", "connection.private.jsonl", "other.log"] {
        std::fs::write(dir.path().join(name), b"preserve").unwrap();
    }
    for _ in 0..3 {
        let diagnostics = Diagnostics::new(dir.path().to_owned());
        let files = log_files(dir.path()).unwrap();
        assert_eq!(files.len(), 7);
        assert!(!dir.path().join("connection.2020-01-04.jsonl").exists());
        assert!(dir.path().join("connection.2020-01-05.jsonl").exists());
        assert_eq!(diagnostics.recent().len(), 1);
    }
    for name in ["connection.log", "connection.private.jsonl", "other.log"] {
        assert_eq!(std::fs::read(dir.path().join(name)).unwrap(), b"preserve");
    }
}

#[test]
fn caps_disk_usage_and_keeps_a_bounded_live_ring_under_concurrent_writes() {
    let dir = tempfile::tempdir().unwrap();
    let diagnostics = Diagnostics::new(dir.path().to_owned());
    diagnostics.writer.0.lock().unwrap().limit = 2000;
    std::thread::scope(|scope| {
        for _ in 0..4 {
            let logger = &diagnostics;
            scope.spawn(move || {
                for _ in 0..200 {
                    logger.record("warning", "connect_failed", "Network unavailable.");
                }
            });
        }
    });
    assert_eq!(diagnostics.recent().len(), MAX_RECENT_ENTRIES);
    assert!(diagnostics.health().dropped_records > 0);
    let file = &log_files(dir.path()).unwrap()[0];
    assert!(std::fs::metadata(file).unwrap().len() <= 2000);
    for line in std::fs::read_to_string(file).unwrap().lines() {
        serde_json::from_str::<serde_json::Value>(line).expect("complete JSON records");
    }
    drop(diagnostics);
    // A restart accounts for bytes already present instead of resetting the daily budget.
    let file = std::fs::OpenOptions::new().write(true).open(file).unwrap();
    file.set_len(MAX_LOG_BYTES).unwrap();
    let restarted = Diagnostics::new(dir.path().to_owned());
    assert_eq!(restarted.health().dropped_records, 1);
    assert_eq!(file.metadata().unwrap().len(), MAX_LOG_BYTES);
}

#[test]
fn sanitizes_local_details_and_control_characters() {
    for input in [
        "peer 192.168.1.12:1234 failed",
        "peer [2001:db8::1234]:2234 failed",
        "peer fe80::dead:beef%12 failed",
        "password=secret-value",
        "Token: bearer-value",
        "https://user:password@host.example/path",
        "C:\\Users\\Private\\Music",
    ] {
        let sanitized = sanitize(input);
        assert!(sanitized.contains("[redacted]"), "{input}");
        assert!(!sanitized.contains("secret-value"));
        assert!(!sanitized.contains("192.168.1.12"));
    }
    assert_eq!(sanitize("first\nsecond\tthird"), "first second third");
    assert_eq!(sanitize(&"é".repeat(600)).chars().count(), 500);
}

#[test]
fn entering_a_new_day_resets_the_budget_and_prunes_old_logs() {
    let dir = tempfile::tempdir().unwrap();
    let diagnostics = Diagnostics::new(dir.path().to_owned());
    for day in 1..=8 {
        std::fs::write(
            dir.path()
                .join(format!("connection.2020-01-{day:02}.jsonl")),
            b"old",
        )
        .unwrap();
    }
    {
        let mut writer = diagnostics.writer.0.lock().unwrap();
        writer.day = writer.day.previous_day().unwrap();
        writer.bytes = MAX_LOG_BYTES;
        writer.health.daily_limit_reached = true;
        writer.health.dropped_records = 2;
    }
    diagnostics.record("info", "connected", "Connected after midnight.");
    assert!(!diagnostics.health().daily_limit_reached);
    assert_eq!(diagnostics.health().dropped_records, 2);
    assert_eq!(log_files(dir.path()).unwrap().len(), 7);
    let today = log_files(dir.path()).unwrap().pop().unwrap();
    assert!(std::fs::read_to_string(today)
        .unwrap()
        .contains("Connected after midnight."));
}

#[test]
fn panic_hook_child() {
    if let Some(path) = std::env::var_os("FOREVER_TEST_PANIC_DIR") {
        install_panic_hook(PathBuf::from(path));
        panic!("password=SYNTHETIC_SECRET peer=192.0.2.14 C:\\Private\\path");
    }
}

#[test]
fn captures_a_real_startup_panic_without_the_payload_or_absolute_source_path() {
    let dir = tempfile::tempdir().unwrap();
    let log_dir = dir.path().join("not-created-yet");
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "connection::diagnostics::tests::panic_hook_child",
            "--nocapture",
        ])
        .env("FOREVER_TEST_PANIC_DIR", &log_dir)
        .output()
        .unwrap();
    assert!(!output.status.success());
    let report = std::fs::read_to_string(log_dir.join("crash-latest.json")).unwrap();
    assert!(!report.contains("SYNTHETIC_SECRET"));
    assert!(!report.contains("192.0.2.14"));
    assert!(!report.contains("Private"));
    assert!(!report.contains("src-tauri"));
    let report: CrashReport = serde_json::from_str(&report).unwrap();
    assert!(report.line > 0);
    assert_eq!(report.app_version, env!("CARGO_PKG_VERSION"));
    write_crash_report(&log_dir, Some(("C:\\Private\\service.rs", 123, 4))).unwrap();
    let report: CrashReport =
        serde_json::from_slice(&std::fs::read(log_dir.join("crash-latest.json")).unwrap()).unwrap();
    assert_eq!(report.source_file, "service.rs");
    assert_eq!(report.line, 123);
    assert_eq!(std::fs::read_dir(log_dir).unwrap().count(), 1);
}
