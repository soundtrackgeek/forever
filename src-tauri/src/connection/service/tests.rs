use super::super::bandwidth::{Bandwidth, BandwidthSettings};
use super::super::protocol::{
    parse_distributed_branch_root, read_peer_init, server_ping_frame, set_online_frame,
    ParentCandidate, PeerInit, DISTRIBUTED_BRANCH_ROOT_CODE,
};
use super::super::uploads::UploadTicket;
use super::network::{
    spawn_distributed_parent_candidate, DistributedCandidateTask, DistributedCoordinator,
    DistributedPeerEvent,
};
use super::peers::{send_file, UploadMeasurement};
use super::session::forward_server_frames;
use super::{rejection_failure, retry_delay, AbortOnDrop};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::time::timeout;

fn upload_fixture(directory: &Path, bytes: &[u8]) -> UploadTicket {
    let local_path = directory.join("shared.flac");
    std::fs::write(&local_path, bytes).unwrap();
    UploadTicket {
        id: "upload".into(),
        username: "downloader".into(),
        remote_filename: "Music\\shared.flac".into(),
        size_bytes: bytes.len() as u64,
        local_path,
        connection_token: 1,
        transfer_token: 2,
    }
}

#[tokio::test]
async fn bandwidth_paces_real_upload_and_download_payloads_and_preserves_resume() {
    use super::super::bandwidth::Limits;
    use super::super::downloads::DownloadPlan;
    use super::peers::receive_file_contents;
    let directory = tempfile::tempdir().unwrap();
    let bytes = vec![42; 1024];
    let upload_plan = upload_fixture(directory.path(), &bytes);
    let download_plan = DownloadPlan {
        id: "download".into(),
        partial_path: directory.path().join("download.part"),
        final_path: directory.path().join("download.flac"),
        size_bytes: 1024,
        offset: 128,
        transfer_token: 3,
    };
    std::fs::write(&download_plan.partial_path, &bytes[..128]).unwrap();
    let limiter = Bandwidth::new(BandwidthSettings {
        normal: Limits {
            total_kib: 2,
            download_kib: 2,
            upload_kib: 2,
        },
        ..Default::default()
    });
    let (sender, receiver) = tokio::io::duplex(128);
    let stop = AtomicBool::new(false);
    let started = tokio::time::Instant::now();
    let (sent, received) = tokio::join!(
        send_file(
            sender,
            &upload_plan,
            Arc::new(AtomicBool::new(false)),
            limiter.clone(),
            |_, _| {}
        ),
        receive_file_contents(receiver, &download_plan, &stop, limiter, |_, _| {})
    );
    assert_eq!(sent.unwrap().unwrap().bytes_sent, 896);
    assert!(received.unwrap());
    assert_eq!(std::fs::read(&download_plan.partial_path).unwrap(), bytes);
    // The same governor accounts for both ends: 896 uploaded + 896 downloaded.
    assert!(started.elapsed() >= Duration::from_millis(850));
}

#[tokio::test(start_paused = true)]
async fn metered_hold_does_not_become_a_download_timeout_and_cancel_secures_partial() {
    use super::super::bandwidth::NetworkCost;
    use super::super::downloads::DownloadPlan;
    use super::peers::receive_file_contents;
    let directory = tempfile::tempdir().unwrap();
    let plan = DownloadPlan {
        id: "download".into(),
        partial_path: directory.path().join("download.part"),
        final_path: directory.path().join("download.flac"),
        size_bytes: 8,
        offset: 3,
        transfer_token: 3,
    };
    std::fs::write(&plan.partial_path, b"012").unwrap();
    let limiter = Bandwidth::new(BandwidthSettings {
        pause_on_metered: true,
        ..Default::default()
    });
    let (mut peer, stream) = tokio::io::duplex(128);
    let stop = Arc::new(AtomicBool::new(false));
    let c = stop.clone();
    let l = limiter.clone();
    let p = plan.clone();
    let task =
        tokio::spawn(async move { receive_file_contents(stream, &p, &c, l, |_, _| {}).await });
    assert_eq!(peer.read_u64_le().await.unwrap(), 3);
    tokio::time::advance(Duration::from_secs(120)).await;
    assert!(!task.is_finished());
    limiter.environment(600, NetworkCost::Unmetered);
    // No source data for 100 ms after the two minute hold: it must still wait.
    tokio::time::advance(Duration::from_millis(100)).await;
    tokio::task::yield_now().await;
    assert!(!task.is_finished());
    limiter.environment(600, NetworkCost::Metered);
    stop.store(true, Ordering::SeqCst);
    assert!(!task.await.unwrap().unwrap());
    assert_eq!(std::fs::read(&plan.partial_path).unwrap(), b"012");
}

#[tokio::test]
async fn cancelling_an_upload_held_by_metering_is_not_a_failure() {
    let directory = tempfile::tempdir().unwrap();
    let plan = upload_fixture(directory.path(), b"01234567");
    let limiter = Bandwidth::new(BandwidthSettings {
        pause_on_metered: true,
        ..Default::default()
    });
    let (mut peer, stream) = tokio::io::duplex(128);
    peer.write_u64_le(0).await.unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let s = stop.clone();
    let task = tokio::spawn(async move { send_file(stream, &plan, s, limiter, |_, _| {}).await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!task.is_finished());
    stop.store(true, Ordering::SeqCst);
    assert!(timeout(Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .is_none());
}

#[test]
fn upload_average_uses_attempt_bytes_and_saturates_the_wire_integer() {
    for (bytes_sent, elapsed, expected) in [
        (3_000, Duration::from_secs(2), Some(1_500)),
        (3_000, Duration::from_millis(500), Some(6_000)),
        (u64::MAX, Duration::from_nanos(1), Some(u32::MAX)),
        (1, Duration::from_secs(2), Some(1)),
        (0, Duration::from_secs(1), None),
        (1, Duration::ZERO, None),
    ] {
        assert_eq!(
            UploadMeasurement {
                bytes_sent,
                elapsed
            }
            .average_speed(),
            expected
        );
    }
}

#[tokio::test]
async fn uploads_measure_only_new_bytes_and_wait_for_downloader_close() {
    let directory = tempfile::tempdir().unwrap();
    let bytes = b"01234567";
    let plan = upload_fixture(directory.path(), bytes);
    for offset in [0, 3, 8] {
        let (mut peer, stream) = tokio::io::duplex(64);
        let mut progress = Vec::new();
        let mut upload = Box::pin(send_file(
            stream,
            &plan,
            Arc::new(AtomicBool::new(false)),
            Bandwidth::new(BandwidthSettings::default()),
            |total, speed| progress.push((total, speed)),
        ));
        peer.write_u64_le(offset).await.unwrap();
        let mut received = vec![0; bytes.len() - offset as usize];
        tokio::select! {
            result = upload.as_mut() => panic!("upload completed before the downloader closed: {result:?}"),
            result = peer.read_exact(&mut received) => { result.unwrap(); }
        }
        assert_eq!(received, bytes[offset as usize..]);
        // Poll the upload while the downloader still owns the open stream.
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(upload.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        peer.shutdown().await.unwrap();
        let measurement = timeout(Duration::from_secs(5), upload)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(measurement.bytes_sent, plan.size_bytes - offset);
        assert_eq!(
            measurement.average_speed().is_some(),
            offset < plan.size_bytes
        );
        if offset < plan.size_bytes {
            assert_eq!(progress.last().unwrap().0, plan.size_bytes);
        }
    }
}

#[tokio::test]
async fn cancelled_uploads_have_no_completion_measurement() {
    let directory = tempfile::tempdir().unwrap();
    let plan = upload_fixture(directory.path(), b"01234567");
    let cancellation = Arc::new(AtomicBool::new(true));
    let (_peer, stream) = tokio::io::duplex(64);
    assert!(send_file(
        stream,
        &plan,
        cancellation.clone(),
        Bandwidth::new(BandwidthSettings::default()),
        |_, _| {}
    )
    .await
    .unwrap()
    .is_none());

    cancellation.store(false, Ordering::SeqCst);
    let (mut peer, stream) = tokio::io::duplex(64);
    let mut upload = Box::pin(send_file(
        stream,
        &plan,
        cancellation.clone(),
        Bandwidth::new(BandwidthSettings::default()),
        |_, _| {},
    ));
    peer.write_u64_le(0).await.unwrap();
    let mut received = [0; 8];
    tokio::select! {
        result = upload.as_mut() => panic!("completed before close: {result:?}"),
        result = peer.read_exact(&mut received) => { result.unwrap(); }
    }
    cancellation.store(true, Ordering::SeqCst);
    assert!(timeout(Duration::from_secs(5), upload)
        .await
        .unwrap()
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn failed_uploads_have_no_completion_measurement() {
    let directory = tempfile::tempdir().unwrap();
    let plan = upload_fixture(directory.path(), b"01234567");
    for (offset, extra, expected) in [
        (9, false, "invalid resume offset"),
        (0, true, "unexpected data"),
    ] {
        let (mut peer, stream) = tokio::io::duplex(64);
        peer.write_u64_le(offset).await.unwrap();
        if extra {
            peer.write_all(&[1]).await.unwrap();
        }
        let error = send_file(
            stream,
            &plan,
            Arc::new(AtomicBool::new(false)),
            Bandwidth::new(BandwidthSettings::default()),
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains(expected), "{error}");
    }
    let (mut peer, stream) = tokio::io::duplex(64);
    peer.write_u64_le(0).await.unwrap();
    drop(peer);
    assert!(send_file(
        stream,
        &plan,
        Arc::new(AtomicBool::new(false)),
        Bandwidth::new(BandwidthSettings::default()),
        |_, _| {}
    )
    .await
    .is_err());

    std::fs::write(&plan.local_path, b"short").unwrap();
    let (mut peer, stream) = tokio::io::duplex(64);
    peer.write_u64_le(0).await.unwrap();
    assert!(send_file(
        stream,
        &plan,
        Arc::new(AtomicBool::new(false)),
        Bandwidth::new(BandwidthSettings::default()),
        |_, _| {}
    )
    .await
    .unwrap_err()
    .contains("ended before"));
}

#[test]
fn reconnect_backoff_caps_at_thirty_seconds() {
    assert_eq!(retry_delay(1), Duration::from_secs(2));
    assert_eq!(retry_delay(2), Duration::from_secs(4));
    assert_eq!(retry_delay(6), Duration::from_secs(30));
    assert_eq!(retry_delay(30), Duration::from_secs(30));
}

#[test]
fn rejection_messages_are_safe_and_actionable() {
    let invalid_password = rejection_failure("INVALIDPASS", None);
    assert!(!invalid_password.retryable);
    assert!(invalid_password.message.contains("username or password"));

    let invalid_username = rejection_failure("INVALIDUSERNAME", Some("Name unavailable."));
    assert_eq!(invalid_username.message, "Name unavailable.");
}

#[tokio::test]
async fn server_frame_pump_preserves_fragmented_frames_while_other_events_fire() {
    let (mut writer, reader) = tokio::io::duplex(64);
    let (sender, mut receiver) = mpsc::channel(2);
    let pump = tokio::spawn(forward_server_frames(reader, sender));
    let first = server_ping_frame();
    let second = set_online_frame();

    let fragmented_writer = tokio::spawn(async move {
        for byte in first.into_iter().chain(second) {
            writer.write_all(&[byte]).await.unwrap();
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    });
    let mut competing_tick = tokio::time::interval(Duration::from_millis(1));
    let mut competing_events = 0;
    let mut received = Vec::new();
    while received.len() < 2 {
        tokio::select! {
            biased;
            _ = competing_tick.tick(), if competing_events == 0 => competing_events += 1,
            frame = receiver.recv() => received.push(frame.unwrap().unwrap()),
        }
    }

    assert!(competing_events > 0);
    assert_eq!(received[0].code, super::super::protocol::SERVER_PING_CODE);
    assert_eq!(received[1].code, super::super::protocol::SET_STATUS_CODE);
    fragmented_writer.await.unwrap();
    pump.abort();
}

#[tokio::test]
async fn distributed_coordinator_adopts_only_a_candidate_with_branch_state() {
    let mut coordinator = DistributedCoordinator::new();
    coordinator.candidates.insert(
        7,
        DistributedCandidateTask {
            username: "candidate-seven".into(),
            branch_level: None,
            branch_root: None,
            _task: AbortOnDrop(tauri::async_runtime::spawn(std::future::pending())),
        },
    );
    coordinator.candidates.insert(
        8,
        DistributedCandidateTask {
            username: "candidate-eight".into(),
            branch_level: Some(3),
            branch_root: Some("branch-root".to_owned()),
            _task: AbortOnDrop(tauri::async_runtime::spawn(std::future::pending())),
        },
    );

    assert_eq!(coordinator.adopt(7), None);
    assert_eq!(coordinator.adopt(8), Some((4, "branch-root".to_owned())));
    assert!(coordinator.accepts_search_from(8));
    assert_eq!(coordinator.candidates.len(), 1);
    assert!(coordinator.close(8));
    coordinator.candidates.insert(
        9,
        DistributedCandidateTask {
            username: "root-without-root-message".into(),
            branch_level: None,
            branch_root: None,
            _task: AbortOnDrop(tauri::async_runtime::spawn(std::future::pending())),
        },
    );
    coordinator.update_branch_level(9, 0);
    assert_eq!(
        coordinator.adopt(9),
        Some((1, "root-without-root-message".into()))
    );
}

#[tokio::test]
async fn distributed_parent_connection_sends_d_init_and_streams_frames() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let (event_sender, mut event_receiver) = mpsc::channel(4);
    let parent = ParentCandidate {
        username: "relay-user".to_owned(),
        address: "127.0.0.1".parse().unwrap(),
        port: address.port(),
    };
    let candidate_task =
        spawn_distributed_parent_candidate(17, parent, "forever-user".to_owned(), event_sender);

    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        assert_eq!(
            read_peer_init(&mut stream).await.unwrap(),
            PeerInit::Peer {
                username: "forever-user".to_owned(),
                connection_type: "D".to_owned(),
                token: 0,
            }
        );
        let mut payload = Vec::new();
        payload.extend(11_u32.to_le_bytes());
        payload.extend(b"branch-root");
        let mut frame = Vec::new();
        frame.extend(u32::try_from(payload.len() + 1).unwrap().to_le_bytes());
        frame.push(DISTRIBUTED_BRANCH_ROOT_CODE);
        frame.extend(payload);
        stream.write_all(&frame).await.unwrap();
    });

    let event = timeout(Duration::from_secs(2), event_receiver.recv())
        .await
        .unwrap()
        .unwrap();
    let DistributedPeerEvent::Frame { id, frame } = event else {
        panic!("expected a distributed frame");
    };
    assert_eq!(id, 17);
    assert_eq!(
        parse_distributed_branch_root(&frame).unwrap(),
        "branch-root"
    );
    peer.await.unwrap();
    drop(candidate_task);
}
