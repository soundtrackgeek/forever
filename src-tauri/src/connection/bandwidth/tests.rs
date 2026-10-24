use super::*;

fn limited(total: u32, download: u32, upload: u32) -> BandwidthSettings {
    BandwidthSettings {
        normal: Limits {
            total_kib: total,
            download_kib: download,
            upload_kib: upload,
        },
        ..Default::default()
    }
}

#[test]
fn daily_windows_have_exclusive_ends_and_follow_local_clock_changes() {
    let mut settings = BandwidthSettings {
        schedule_enabled: true,
        ..Default::default()
    };
    for (minute, active) in [
        (1379, false),
        (1380, true),
        (1439, true),
        (0, true),
        (419, true),
        (420, false),
    ] {
        assert_eq!(settings.alternate_at(minute), active);
    }
    settings.start_minute = 9 * 60;
    settings.end_minute = 17 * 60;
    for (minute, active) in [(539, false), (540, true), (1019, true), (1020, false)] {
        assert_eq!(settings.alternate_at(minute), active);
    }
    let control = Bandwidth::new(settings);
    control.environment(600, NetworkCost::Unmetered);
    assert!(control.snapshot().alternate_active);
    // DST/timezone/system-time changes are evaluated from the new wall clock.
    control.environment(520, NetworkCost::Unmetered);
    assert!(!control.snapshot().alternate_active);
    control.environment(600, NetworkCost::Unmetered);
    assert!(control.snapshot().alternate_active);
}

#[test]
fn validation_rejects_bad_limits_and_empty_windows() {
    assert!(limited(1_000_001, 0, 0).validate().is_err());
    let mut settings = BandwidthSettings {
        start_minute: 1440,
        ..Default::default()
    };
    assert!(settings.validate().is_err());
    settings.start_minute = settings.end_minute;
    assert!(settings.validate().is_ok());
    settings.schedule_enabled = true;
    assert!(settings.validate().is_err());
    assert!(
        serde_json::from_str::<Limits>(r#"{"totalKib":-1,"downloadKib":0,"uploadKib":0}"#).is_err()
    );
}

#[tokio::test(start_paused = true)]
async fn concurrent_lanes_share_both_direction_and_combined_budgets() {
    let control = Bandwidth::new(limited(4, 3, 1));
    let totals = Arc::new(Mutex::new([0_usize; 3]));
    let started = Instant::now();
    let mut jobs = Vec::new();
    for lane in 0..8 {
        let control = control.clone();
        let totals = totals.clone();
        jobs.push(tokio::spawn(async move {
            let direction = if lane < 6 {
                Direction::Download
            } else {
                Direction::Upload
            };
            let cancel = AtomicBool::new(false);
            let mut sent = 0;
            while sent < 1024 {
                let mut permit = control
                    .acquire(direction, 1024 - sent, &cancel)
                    .await
                    .unwrap();
                sent += permit.count;
                permit.used(permit.count);
                let mut totals = totals.lock().unwrap();
                totals[0] += permit.count;
                totals[direction.index()] += permit.count;
                let elapsed = started.elapsed().as_secs_f64();
                for (count, rate) in totals.iter().zip([4096.0, 3072.0, 1024.0]) {
                    assert!(
                        *count as f64 <= elapsed * rate + 1.0,
                        "{count} exceeded {rate} at {elapsed}"
                    );
                }
            }
        }));
    }
    for job in jobs {
        job.await.unwrap();
    }
    assert_eq!(*totals.lock().unwrap(), [8192, 6144, 2048]);
    assert!(started.elapsed() >= Duration::from_secs(2));
}

#[tokio::test(start_paused = true)]
async fn short_reads_refund_unused_tokens_and_idle_credit_is_bounded() {
    let control = Bandwidth::new(limited(1, 0, 0));
    let cancel = AtomicBool::new(false);
    tokio::time::advance(Duration::from_secs(100)).await;
    let mut first = control
        .acquire(Direction::Download, 128 * 1024, &cancel)
        .await
        .unwrap();
    assert_eq!(first.count, 256);
    first.used(16);
    drop(first);
    let started = Instant::now();
    let next = control
        .acquire(Direction::Upload, 1000, &cancel)
        .await
        .unwrap();
    assert_eq!(next.count, 240);
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn metered_and_unknown_hold_both_directions_and_cancellation_stays_responsive() {
    let control = Bandwidth::new(BandwidthSettings {
        pause_on_metered: true,
        ..Default::default()
    });
    assert!(control.paused());
    for direction in [Direction::Download, Direction::Upload] {
        let cancellation = Arc::new(AtomicBool::new(false));
        let c = control.clone();
        let stop = cancellation.clone();
        let job = tokio::spawn(async move { c.acquire(direction, 100, &stop).await });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(3600)).await;
        assert!(!job.is_finished());
        cancellation.store(true, Ordering::SeqCst);
        assert!(tokio::time::timeout(Duration::from_millis(60), job)
            .await
            .unwrap()
            .unwrap()
            .is_none());
    }
    control.environment(600, NetworkCost::Metered);
    assert!(control.paused());
    control.environment(600, NetworkCost::Unmetered);
    assert!(!control.paused());
    assert_eq!(
        control
            .acquire(Direction::Download, 42, &AtomicBool::new(false))
            .await
            .unwrap()
            .count,
        42
    );
}

#[tokio::test(start_paused = true)]
async fn edits_and_schedule_transitions_wake_waiters_without_carrying_old_credit() {
    let mut settings = limited(0, 0, 0);
    settings.pause_on_metered = true;
    let control = Bandwidth::new(settings.clone());
    let c = control.clone();
    let job = tokio::spawn(async move {
        c.acquire(Direction::Download, 100, &AtomicBool::new(false))
            .await
    });
    tokio::task::yield_now().await;
    settings.pause_on_metered = false;
    control.configure(settings.clone());
    assert_eq!(job.await.unwrap().unwrap().count, 100);
    settings.schedule_enabled = true;
    settings.alternate = Limits {
        total_kib: 1,
        ..Default::default()
    };
    control.configure(settings);
    control.environment(1400, NetworkCost::Unmetered);
    let start = Instant::now();
    let permit = control
        .acquire(Direction::Upload, 100, &AtomicBool::new(false))
        .await
        .unwrap();
    assert!(start.elapsed() > Duration::ZERO);
    drop(permit);
    control.environment(600, NetworkCost::Unmetered);
    assert_eq!(
        control
            .acquire(Direction::Upload, 100, &AtomicBool::new(false))
            .await
            .unwrap()
            .count,
        100
    );
}

#[test]
fn older_settings_import_defaults_to_unlimited_and_round_trips_policy() {
    use crate::connection::app_settings::{parse_import, Settings, SettingsPatch};
    let mut legacy = serde_json::to_value(Settings::default()).unwrap();
    legacy["transfers"]
        .as_object_mut()
        .unwrap()
        .remove("bandwidth");
    let mut settings = parse_import(&legacy.to_string()).unwrap();
    assert_eq!(settings.transfers.bandwidth, BandwidthSettings::default());
    SettingsPatch {
        bandwidth: Some(limited(100, 80, 30)),
        ..Default::default()
    }
    .apply(&mut settings);
    assert_eq!(
        parse_import(&serde_json::to_string(&settings).unwrap()).unwrap(),
        settings
    );
    settings.transfers.bandwidth.normal.total_kib = 1_000_001;
    assert!(parse_import(&serde_json::to_string(&settings).unwrap()).is_err());
}

#[tokio::test(start_paused = true)]
async fn manual_pause_holds_both_directions_and_resume_preserves_metered_policy() {
    let mut settings = BandwidthSettings {
        manual_paused: true,
        pause_on_metered: true,
        ..Default::default()
    };
    let control = Bandwidth::new(settings.clone());
    control.environment(600, NetworkCost::Unmetered);
    let mut jobs = Vec::new();
    for direction in [Direction::Download, Direction::Upload] {
        let c = control.clone();
        jobs.push(tokio::spawn(async move {
            c.acquire(direction, 100, &AtomicBool::new(false)).await
        }));
    }
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_secs(60)).await;
    assert!(jobs.iter().all(|j| !j.is_finished()));
    assert!(control.snapshot().manual_paused);
    control.environment(600, NetworkCost::Metered);
    settings.manual_paused = false;
    control.configure(settings);
    assert!(!control.snapshot().manual_paused);
    assert!(control.paused());
    tokio::time::advance(Duration::from_secs(60)).await;
    assert!(jobs.iter().all(|j| !j.is_finished()));
    control.environment(600, NetworkCost::Unmetered);
    for job in jobs {
        assert_eq!(job.await.unwrap().unwrap().count, 100);
    }
}
