use super::super::protocol::{
    file_search_response_frame, parse_search_response, parse_shared_file_list_response,
    shared_file_list_response_frame, Frame,
};
use super::*;

fn wav(path: &Path, sample_rate: u32, bits: u16) {
    let byte_rate = sample_rate * 2 * u32::from(bits / 8);
    let mut bytes = Vec::new();
    bytes.extend(b"RIFF");
    bytes.extend((36 + byte_rate).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16u32.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(sample_rate.to_le_bytes());
    bytes.extend(byte_rate.to_le_bytes());
    bytes.extend((2 * bits / 8).to_le_bytes());
    bytes.extend(bits.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(byte_rate.to_le_bytes());
    bytes.resize(bytes.len() + byte_rate as usize, 0);
    fs::write(path, bytes).unwrap();
}

fn root(path: &Path) -> SharedRootConfig {
    SharedRootConfig {
        id: "music".into(),
        path: path.to_string_lossy().into(),
        alias: "Music".into(),
        enabled: true,
        added_at_ms: 0,
    }
}

fn run(
    root: &SharedRootConfig,
    previous: &ShareIndex,
    paths: Option<&[PathBuf]>,
    database: &Path,
) -> (ShareIndex, u32, u32) {
    let mut cache = IndexCache::open(database);
    let index = reconcile(std::slice::from_ref(root), previous, paths, &mut cache);
    cache.finish(
        index
            .indexed_files
            .iter()
            .map(|file| file.local_path.as_path()),
    );
    assert_eq!(cache.error, None);
    (index, cache.reused, cache.inspected)
}

#[test]
fn rich_headers_survive_restart_and_round_trip_on_the_wire() {
    let temp = tempfile::tempdir().unwrap();
    let music = temp.path().join("music");
    fs::create_dir(&music).unwrap();
    let track = music.join("Hi Res.wav");
    wav(&track, 96_000, 24);
    fs::write(music.join("cover.jpg"), b"image").unwrap();
    fs::write(music.join("broken.flac"), b"not audio").unwrap();
    let original = fs::read(&track).unwrap();
    let config = root(&music);
    let database = temp.path().join("index.sqlite3");
    let (first, reused, inspected) = run(&config, &ShareIndex::default(), None, &database);
    assert_eq!((reused, inspected), (0, 3));
    let quality = &first.indexed_files[*first.files.get("music\\hi res.wav").unwrap()].quality;
    assert_eq!(
        *quality,
        AudioQuality {
            bitrate: Some(4608),
            duration_seconds: Some(1),
            sample_rate: Some(96000),
            bit_depth: Some(24)
        }
    );
    let (second, reused, inspected) = run(&config, &ShareIndex::default(), None, &database);
    assert_eq!((reused, inspected), (3, 0));
    assert_eq!(fs::read(track).unwrap(), original);
    let results = second.search("hi res", &HashSet::new());
    let frame = |bytes: Vec<u8>| Frame {
        code: u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
        payload: bytes[8..].to_vec(),
    };
    let decoded = parse_search_response(&frame(
        file_search_response_frame("user", 1, &results, true, 1000, 0).unwrap(),
    ))
    .unwrap();
    assert_eq!(decoded.files, results);
    let folders = second.visible_folders(None, &HashSet::new());
    let listings: Vec<_> = folders
        .into_iter()
        .map(|folder| ShareListing {
            directory: folder.directory,
            files: folder.files,
            is_private: false,
        })
        .collect();
    let decoded = parse_shared_file_list_response(&frame(
        shared_file_list_response_frame(&listings).unwrap(),
    ))
    .unwrap();
    let audio = decoded.directories[0]
        .files
        .iter()
        .find(|file| file.filename == "Hi Res.wav")
        .unwrap();
    assert_eq!(audio.sample_rate, Some(96_000));
    assert_eq!(audio.bit_depth, Some(24));
    assert_eq!(audio.duration_seconds, Some(1));
    assert!(decoded.directories[0]
        .files
        .iter()
        .filter(|f| f.filename != "Hi Res.wav")
        .all(|f| f.bitrate.is_none()));
}

#[test]
fn incremental_scopes_reuse_siblings_handle_moves_deletions_and_purge_cache() {
    let temp = tempfile::tempdir().unwrap();
    let music = temp.path().join("music");
    for folder in ["A", "B"] {
        fs::create_dir_all(music.join(folder)).unwrap();
    }
    let a = music.join("A/One.wav");
    let b = music.join("B/Two.wav");
    wav(&a, 44_100, 16);
    wav(&b, 44_100, 16);
    let database = temp.path().join("index.sqlite3");
    let mut config = root(&music);
    let (first, _, _) = run(&config, &ShareIndex::default(), None, &database);
    // B has changed but is outside this event's scope: no stat/header read there.
    wav(&b, 96_000, 24);
    let c = music.join("A/Three.wav");
    wav(&c, 48_000, 24);
    let (second, reused, inspected) =
        run(&config, &first, Some(std::slice::from_ref(&c)), &database);
    assert_eq!((reused, inspected), (1, 1));
    assert_eq!(
        second.search("two", &HashSet::new())[0].sample_rate,
        Some(44_100)
    );
    let moved = music.join("B/Renamed.wav");
    fs::rename(&a, &moved).unwrap();
    fs::remove_file(&c).unwrap();
    let (third, _, _) = run(&config, &second, Some(&[a, moved, c]), &database);
    assert!(third.search("one", &HashSet::new()).is_empty());
    assert!(third.search("three", &HashSet::new()).is_empty());
    assert_eq!(
        third.search("two", &HashSet::new())[0].sample_rate,
        Some(96_000)
    );
    assert_eq!(third.roots[0].file_count, 2);
    let db = rusqlite::Connection::open(&database).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM files", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        2
    );
    drop(db);
    config.enabled = false;
    let (disabled, _, _) = run(&config, &third, None, &database);
    assert!(disabled.files.is_empty());
    config.enabled = true;
    let (enabled, reused, inspected) = run(&config, &disabled, None, &database);
    assert_eq!((enabled.files.len(), reused, inspected), (2, 0, 2));
    fs::remove_dir_all(&music).unwrap();
    let (missing, _, _) = run(&config, &enabled, None, &database);
    assert!(missing.files.is_empty());
    assert!(missing.roots[0].error.is_some());
}

#[test]
fn same_size_mtime_changes_are_reinspected_and_failed_cache_preserves_files() {
    let temp = tempfile::tempdir().unwrap();
    let music = temp.path().join("music");
    fs::create_dir(&music).unwrap();
    let path = music.join("audio.wav");
    wav(&path, 44_100, 16);
    let config = root(&music);
    let database = temp.path().join("index.sqlite3");
    let (first, _, _) = run(&config, &ShareIndex::default(), None, &database);
    let old = fs::metadata(&path).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(
            fs::FileTimes::new().set_modified(old.modified().unwrap() + Duration::from_secs(2)),
        )
        .unwrap();
    let (_, reused, inspected) = run(&config, &first, None, &database);
    assert_eq!((reused, inspected), (0, 1));
    fs::write(&database, b"corrupt cache").unwrap();
    let mut cache = IndexCache::open(&database);
    assert!(cache.error.is_some());
    let fallback = reconcile(&[config], &first, None, &mut cache);
    assert_eq!(
        fallback.search("audio", &HashSet::new())[0].sample_rate,
        Some(44_100)
    );
    assert_eq!(fs::read(database).unwrap(), b"corrupt cache");
}

#[test]
fn scopes_collapse_and_ignore_paths_outside_the_share() {
    let root = Path::new("music");
    assert_eq!(
        scan_scopes(
            root,
            &[
                "elsewhere/track.wav".into(),
                "music/A/one.wav".into(),
                "music/A/two.wav".into(),
                "music/A".into()
            ]
        ),
        vec![root.to_path_buf()]
    );
}

#[test]
fn disabled_and_removed_aliases_cannot_be_advertised_from_an_older_index() {
    let mut config = root(Path::new("music"));
    let mut store = SharingStore {
        roots: vec![config.clone()],
        ..Default::default()
    };
    assert!(enabled_remote_path(&store, "Music\\Album\\Track.wav"));
    assert!(enabled_remote_path(&store, "Music"));
    assert!(!enabled_remote_path(&store, "Music Elsewhere\\Track.wav"));
    config.enabled = false;
    store.roots = vec![config];
    assert!(!enabled_remote_path(&store, "Music\\Album\\Track.wav"));
    store.roots.clear();
    assert!(!enabled_remote_path(&store, "Music"));
}

#[test]
fn unfinished_cache_transactions_rollback_and_future_schemas_are_preserved() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("index.sqlite3");
    let path = temp.path().join("audio.wav");
    wav(&path, 44_100, 16);
    {
        let mut interrupted = IndexCache::open(&database);
        interrupted.quality(&path, &fs::metadata(&path).unwrap());
        // No finish/COMMIT, as when a scan is interrupted.
    }
    let mut restored = IndexCache::open(&database);
    restored.quality(&path, &fs::metadata(&path).unwrap());
    assert_eq!((restored.reused, restored.inspected), (0, 1));
    restored.finish(std::iter::once(path.as_path()));
    drop(restored);
    let db = rusqlite::Connection::open(&database).unwrap();
    db.execute_batch("PRAGMA user_version=99").unwrap();
    drop(db);
    let original = fs::read(&database).unwrap();
    let future = IndexCache::open(&database);
    assert!(future.error.is_some());
    drop(future);
    assert_eq!(fs::read(database).unwrap(), original);
}

#[test]
fn flac_and_mp3_headers_publish_quality_without_decoding() {
    let temp = tempfile::tempdir().unwrap();
    let flac = temp.path().join("tone.flac");
    let mp3 = temp.path().join("tone.mp3");
    fs::write(
        &flac,
        include_bytes!("../../../test-fixtures/shares/tone.flac"),
    )
    .unwrap();
    fs::write(
        &mp3,
        include_bytes!("../../../test-fixtures/shares/tone.mp3"),
    )
    .unwrap();
    let mut cache = IndexCache::open(Path::new(":memory:"));
    let lossless = cache.quality(&flac, &fs::metadata(&flac).unwrap());
    assert_eq!(lossless.sample_rate, Some(48_000));
    assert_eq!(lossless.bit_depth, Some(24));
    assert_eq!(lossless.duration_seconds, Some(2));
    let lossy = cache.quality(&mp3, &fs::metadata(&mp3).unwrap());
    assert_eq!(lossy.sample_rate, Some(44_100));
    assert_eq!(lossy.bit_depth, None);
    assert_eq!(lossy.duration_seconds, Some(2));
    assert!((190..=205).contains(&lossy.bitrate.unwrap()));
}

#[cfg(windows)]
#[test]
fn partial_scan_never_follows_a_directory_junction() {
    let temp = tempfile::tempdir().unwrap();
    let music = temp.path().join("music");
    let outside = temp.path().join("outside");
    fs::create_dir(&music).unwrap();
    fs::create_dir(&outside).unwrap();
    wav(&outside.join("Private.wav"), 44_100, 16);
    // Junctions need no elevated symlink privilege on Windows.
    let status = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(music.join("link"))
        .arg(&outside)
        .output()
        .unwrap();
    assert!(status.status.success());
    let config = root(&music);
    let database = temp.path().join("index.sqlite3");
    let (first, _, _) = run(&config, &ShareIndex::default(), None, &database);
    let (partial, _, _) = run(
        &config,
        &first,
        Some(&[music.join("link/Private.wav")]),
        &database,
    );
    assert!(first.files.is_empty() && partial.files.is_empty());
    fs::remove_dir(music.join("link")).unwrap();
    assert!(outside.join("Private.wav").exists());
}

#[test]
fn music_library_measurements_skip_header_reads_only_for_unchanged_files() {
    let temp = tempfile::tempdir().unwrap();
    let mp3 = temp.path().join("tone.mp3");
    fs::write(
        &mp3,
        include_bytes!("../../../test-fixtures/shares/tone.mp3"),
    )
    .unwrap();
    let metadata = fs::metadata(&mp3).unwrap();
    let modified = metadata
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as i64;
    let library = temp.path().join("music-library.sqlite3");
    let db = rusqlite::Connection::open(&library).unwrap();
    db.execute_batch("CREATE TABLE music_doctor_track_quality (file_path TEXT, filename TEXT, size_bytes INTEGER, modified_ns INTEGER, bitrate_kbps INTEGER, duration_ms INTEGER, missing INTEGER);").unwrap();
    let insert = |size: u64| {
        db.execute("DELETE FROM music_doctor_track_quality", [])
            .unwrap();
        db.execute(
            "INSERT INTO music_doctor_track_quality VALUES (?1,'tone.mp3',?2,?3,320,262034,0)",
            rusqlite::params![temp.path().to_string_lossy(), size as i64, modified],
        )
        .unwrap();
    };
    insert(metadata.len());
    let mut cache = IndexCache::open(Path::new(":memory:")).with_library(&library);
    let quality = cache.quality(&mp3, &metadata);
    assert_eq!(
        (quality.bitrate, quality.duration_seconds),
        (Some(320), Some(262))
    );
    assert_eq!((cache.reused, cache.inspected), (1, 0));
    insert(metadata.len() + 1);
    let mut cache = IndexCache::open(Path::new(":memory:")).with_library(&library);
    cache.quality(&mp3, &metadata);
    assert_eq!((cache.reused, cache.inspected), (0, 1));
}

#[test]
fn roots_covered_by_music_library_are_indexed_from_the_database_without_walking() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("shared");
    fs::create_dir(&root).unwrap();
    let library = temp.path().join("music-library.sqlite3");
    let db = rusqlite::Connection::open(&library).unwrap();
    db.execute_batch("CREATE TABLE music_doctor_track_quality (file_path TEXT, filename TEXT, source_path TEXT, relative_path TEXT, size_bytes INTEGER, modified_ns INTEGER, bitrate_kbps INTEGER, duration_ms INTEGER, missing INTEGER);").unwrap();
    for (relative, missing) in [
        (r"Artist - Album (2020)\01 Song.mp3", 0),
        (r"Artist - Album (2020)\02 Gone.mp3", 1),
        (r"..\escape.mp3", 0),
    ] {
        db.execute(
            "INSERT INTO music_doctor_track_quality VALUES ('', '', ?1, ?2, 1000, 0, 320, 262034, ?3)",
            rusqlite::params![root.to_string_lossy(), relative, missing],
        )
        .unwrap();
    }
    let config = SharedRootConfig {
        id: "root".into(),
        path: root.to_string_lossy().into_owned(),
        alias: "Shared".into(),
        enabled: true,
        added_at_ms: 0,
    };
    let mut cache = IndexCache::open(Path::new(":memory:")).with_library(&library);
    let index = reconcile(&[config], &ShareIndex::default(), None, &mut cache);
    assert_eq!(index.indexed_files.len(), 1);
    let file = &index.indexed_files[0];
    assert_eq!(
        file.remote_filename,
        r"Shared\Artist - Album (2020)\01 Song.mp3"
    );
    assert_eq!(file.quality.bitrate, Some(320));
    assert_eq!(file.quality.duration_seconds, Some(262));
    assert_eq!(index.roots[0].file_count, 1);
}
