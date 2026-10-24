use super::*;
use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    prelude::ItemKey,
    tag::Tag,
};
use std::fs;

const MBID: &str = "12345678-1234-1234-1234-123456789abc";
#[test]
fn filing_rejects_duplicate_source_paths_and_older_preferences_get_safe_defaults() {
    let (_dir, mut request, mut transfers) = fixture();
    let mut duplicate = transfers[0].clone();
    duplicate.id = "duplicate".into();
    transfers.push(duplicate);
    let mut tags = values();
    tags.track = 2;
    request.tracks.push(TrackInput {
        transfer_id: "duplicate".into(),
        tags,
    });
    assert!(make_plan(request, transfers, vec![])
        .unwrap_err()
        .contains("same source"));
    let mut settings =
        serde_json::to_value(super::super::app_settings::Settings::default()).unwrap();
    settings["transfers"]
        .as_object_mut()
        .unwrap()
        .remove("filing");
    let migrated: super::super::app_settings::Settings = serde_json::from_value(settings).unwrap();
    assert_eq!(migrated.transfers.filing, FilingSettings::default());
    migrated.validate().unwrap();
    let mut invalid = migrated.clone();
    invalid.transfers.filing.naming_template = "../{title}".into();
    assert!(invalid.validate().is_err());
    let exported = serde_json::to_string(&migrated).unwrap();
    assert_eq!(
        super::super::app_settings::parse_import(&exported)
            .unwrap()
            .transfers
            .filing,
        FilingSettings::default()
    );
}
#[test]
fn filing_transfer_projection_is_atomic_and_undo_does_not_recreate_cleared_history() {
    let (_dir, request, mut transfers) = fixture();
    let original_paths: Vec<_> = transfers.iter().map(|t| t.local_path.clone()).collect();
    let plan = make_plan(request, transfers.clone(), vec![]).unwrap();
    super::super::downloads::apply_filing_paths(&mut transfers, &plan, false, &[123, 456]).unwrap();
    assert_eq!(
        transfers[0].local_path,
        plan.files[0].destination.to_string_lossy()
    );
    assert_eq!(transfers[0].size_bytes, 123);
    assert!(transfers[0].filed_at_ms.is_some());
    super::super::downloads::apply_filing_paths(&mut transfers, &plan, true, &[]).unwrap();
    assert_eq!(
        transfers
            .iter()
            .map(|t| t.local_path.clone())
            .collect::<Vec<_>>(),
        original_paths
    );
    transfers.pop();
    assert!(
        super::super::downloads::apply_filing_paths(&mut transfers, &plan, false, &[123, 456])
            .is_err()
    );
    assert_eq!(transfers[0].local_path, original_paths[0]);
    super::super::downloads::apply_filing_paths(&mut transfers, &plan, true, &[]).unwrap();
    assert_eq!(transfers.len(), 1);
}
fn values() -> TrackTags {
    TrackTags {
        title: "First Song".into(),
        artist: "Guest Artist".into(),
        album_artist: "Album Artist".into(),
        album: "A Record".into(),
        date: "1994-03-01".into(),
        disc: 1,
        track: 1,
        release_group_id: Some(MBID.into()),
        release_id: Some(MBID.into()),
        recording_id: Some(MBID.into()),
    }
}
fn write_wav(path: &Path) {
    let samples = vec![0x23_u8; 16_000];
    let mut bytes = Vec::new();
    bytes.extend(b"RIFF");
    bytes.extend((36 + samples.len() as u32).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16_u32.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(8000_u32.to_le_bytes());
    bytes.extend(16000_u32.to_le_bytes());
    bytes.extend(2_u16.to_le_bytes());
    bytes.extend(16_u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend((samples.len() as u32).to_le_bytes());
    bytes.extend(samples);
    fs::write(path, bytes).unwrap();
}
fn transfer(path: &Path, id: &str) -> TransferSnapshot {
    serde_json::from_value(serde_json::json!({ "id":id,"releaseId":"release", "releaseTitle":"Artist - Album", "releaseFolder":path.parent().unwrap(), "title":path.file_name().unwrap().to_str().unwrap(), "username":"peer", "remoteFilename":"Music/track.wav", "sizeBytes":fs::metadata(path).unwrap().len(), "transferredBytes":fs::metadata(path).unwrap().len(), "speedBytesPerSecond":0, "etaSeconds":0, "status":"completed", "queuePosition":null, "localPath":path, "error":null,"createdAtMs":1,"updatedAtMs":1 })).unwrap()
}
fn fixture() -> (tempfile::TempDir, FilingRequest, Vec<TransferSnapshot>) {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("downloads");
    let root = dir.path().join("library");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&root).unwrap();
    let wav = source.join("01 song.wav");
    write_wav(&wav);
    let cover = source.join("booklet.txt");
    fs::write(&cover, b"Keep the booklet").unwrap();
    let transfers = vec![transfer(&wav, "audio"), transfer(&cover, "companion")];
    let request = FilingRequest {
        release_id: "release".into(),
        settings: FilingSettings {
            library_root: root.to_string_lossy().into_owned(),
            ..Default::default()
        },
        tracks: vec![TrackInput {
            transfer_id: "audio".into(),
            tags: values(),
        }],
        artwork_release_id: None,
    };
    (dir, request, transfers)
}

#[test]
fn filing_preview_writes_nothing_apply_tags_and_undo_restores_exact_bytes() {
    let (_dir, request, transfers) = fixture();
    let original = fs::read(&transfers[0].local_path).unwrap();
    let mut plan = make_plan(request, transfers, vec![]).unwrap();
    assert!(!plan.stage_directory.exists());
    assert!(fs::read_dir(&plan.library_root).unwrap().next().is_none());
    stage(&mut plan).unwrap();
    publish(&plan).unwrap();
    assert!(!plan.files[0].source.exists());
    assert_eq!(fs::read(&plan.files[0].backup).unwrap(), original);
    assert_eq!(
        fs::read(&plan.files[1].destination).unwrap(),
        b"Keep the booklet"
    );
    let tags = tags::read_tags(&plan.files[0].destination).unwrap();
    assert!(tags.contains(&("Artist".into(), "Guest Artist".into())));
    assert!(tags.contains(&("Album artist".into(), "Album Artist".into())));
    assert!(tags.contains(&("Recording MBID".into(), MBID.into())));
    // WAV data chunk remains byte-identical after tag writing.
    let output = fs::read(&plan.files[0].destination).unwrap();
    let data = output.windows(4).position(|w| w == b"data").unwrap() + 8;
    assert_eq!(&output[data..data + 16_000], &original[44..]);
    rollback(&plan).unwrap();
    rollback(&plan).unwrap();
    assert_eq!(fs::read(&plan.files[0].source).unwrap(), original);
    assert!(!plan.files[0].destination.exists());
    assert!(!plan.files[0].backup.exists());
}
#[test]
fn filing_tags_preserve_unrelated_metadata_and_embed_front_cover_in_flac() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("music.flac");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("test-fixtures/soundcheck/01-broadband.flac"),
        &path,
    )
    .unwrap();
    let mut audio = lofty::read_from_path(&path).unwrap();
    if audio.primary_tag().is_none() {
        audio.insert_tag(Tag::new(audio.primary_tag_type()));
    }
    audio
        .primary_tag_mut()
        .unwrap()
        .insert_text(ItemKey::Comment, "keep this comment".into());
    audio.save_to_path(&path, WriteOptions::default()).unwrap();
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=").unwrap();
    tags::write_tags(&path, &values(), &png).unwrap();
    let audio = lofty::read_from_path(&path).unwrap();
    assert_eq!(
        audio.primary_tag().unwrap().get_string(ItemKey::Comment),
        Some("keep this comment")
    );
    assert_eq!(audio.primary_tag().unwrap().pictures()[0].data(), png);
}
#[test]
fn filing_rejects_collision_stale_preview_and_duplicate_mapping() {
    let (_dir, request, transfers) = fixture();
    let plan = make_plan(request.clone(), transfers.clone(), vec![]).unwrap();
    fs::create_dir_all(plan.files[0].destination.parent().unwrap()).unwrap();
    fs::write(&plan.files[0].destination, b"existing").unwrap();
    assert!(preflight(&plan).is_err());
    assert_eq!(fs::read(&plan.files[0].destination).unwrap(), b"existing");
    fs::remove_file(&plan.files[0].destination).unwrap();
    fs::write(&plan.files[1].source, b"changed").unwrap();
    assert!(preflight(&plan).unwrap_err().contains("changed"));
    let mut request = request;
    request.tracks.push(request.tracks[0].clone());
    assert!(make_plan(request, transfers, vec![])
        .unwrap_err()
        .contains("exactly once"));
}
#[test]
fn filing_undo_preserves_later_edits_and_conflicting_originals() {
    let (_dir, request, transfers) = fixture();
    let mut plan = make_plan(request, transfers, vec![]).unwrap();
    stage(&mut plan).unwrap();
    publish(&plan).unwrap();
    let destination = fs::read(&plan.files[0].destination).unwrap();
    fs::write(&plan.files[0].destination, b"later edit").unwrap();
    assert!(rollback(&plan).is_err());
    assert_eq!(fs::read(&plan.files[0].destination).unwrap(), b"later edit");
    assert!(plan.files[0].backup.exists());
    fs::write(&plan.files[0].destination, destination).unwrap();
    fs::write(&plan.files[1].source, b"new file at old location").unwrap();
    assert!(rollback(&plan).is_err());
    assert!(plan.files[0].destination.exists());
}
#[test]
fn filing_journal_recovers_interruptions_at_each_publication_boundary() {
    for phase in 0..5 {
        let (dir, request, transfers) = fixture();
        let mut plan = make_plan(request, transfers, vec![]).unwrap();
        let original = fs::read(&plan.files[0].source).unwrap();
        if phase > 0 {
            stage(&mut plan).unwrap();
        }
        let journal = JsonFile::new(dir.path().join("filing.json"));
        journal
            .save(&Journal {
                version: 1,
                records: vec![FilingRecord {
                    plan: plan.clone(),
                    state: FilingState::Applying,
                }],
            })
            .unwrap();
        if phase > 1 {
            fs::create_dir_all(&plan.album_directory).unwrap();
            fs::hard_link(&plan.files[0].staged, &plan.files[0].destination).unwrap();
        }
        if phase > 2 {
            fs::hard_link(&plan.files[0].source, &plan.files[0].backup).unwrap();
        }
        if phase > 3 {
            fs::remove_file(&plan.files[0].source).unwrap();
        }
        let loaded: Journal = JsonFile::new(dir.path().join("filing.json"))
            .load(Journal::default, |b| store::decode(b, 1, None, &[]));
        rollback(&loaded.records[0].plan).unwrap();
        assert_eq!(fs::read(&plan.files[0].source).unwrap(), original);
        assert!(!plan.files[0].destination.exists());
    }
}
#[test]
fn filing_templates_sanitize_values_but_reject_unsafe_structure() {
    for template in [
        "../{title}",
        "C:/{title}",
        "{album}/../{title}",
        "{unknown}/{title}",
        "{album}\\{title}",
        "/{album}/{title}",
    ] {
        assert!(validate_template(template).is_err(), "{template}");
    }
    let mut tags = values();
    tags.album_artist = "CON".into();
    tags.title = "a/b:c?".into();
    assert_eq!(
        render_template("{albumartist}/{album}/{disc}{track:02} {title}", &tags).unwrap(),
        "_CON/A Record/101 a_b_c_"
    );
}
#[test]
fn filing_rejects_missing_unmapped_unsupported_and_incomplete_audio() {
    let (_dir, mut request, mut transfers) = fixture();
    request.tracks.clear();
    assert!(make_plan(request.clone(), transfers.clone(), vec![]).is_err());
    request.tracks.push(TrackInput {
        transfer_id: "audio".into(),
        tags: values(),
    });
    transfers[0].status = TransferStatus::Downloading;
    assert!(make_plan(request.clone(), transfers.clone(), vec![]).is_err());
    transfers[0].status = TransferStatus::Completed;
    fs::write(&transfers[0].local_path, b"fake audio").unwrap();
    transfers[0].size_bytes = 10;
    assert!(make_plan(request, transfers, vec![]).is_err());
}
#[cfg(windows)]
#[test]
fn filing_rejects_directory_junctions() {
    let dir = tempfile::tempdir().unwrap();
    let actual = dir.path().join("actual");
    let link = dir.path().join("junction");
    fs::create_dir(&actual).unwrap();
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&actual)
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(safe_path(&link.join("track.wav")).is_err());
    fs::remove_dir(link).unwrap();
}
