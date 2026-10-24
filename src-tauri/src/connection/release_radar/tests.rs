use super::*;
const ID: &str = "0383dadf-2a4e-4d10-a46a-e9e041da8eb3";
const ALBUM: &str = "5441c29d-3602-4898-b1a1-b77fa23b8e50";

fn catalog() -> AlbumCatalog {
    AlbumCatalog {
        artist_id: ID.into(),
        truncated: false,
        albums: vec![AlbumReleaseGroup {
            id: ALBUM.into(),
            title: "New album".into(),
            first_release_date: today().to_string(),
            primary_type: Some("Album".into()),
            secondary_types: vec![],
            cover_art_url: String::new(),
        }],
    }
}
fn hub() -> (tempfile::TempDir, ReleaseRadar) {
    let dir = tempfile::tempdir().unwrap();
    let hub = ReleaseRadar::new(dir.path().join("radar.json"));
    hub.follow(ID, "Artist", false).unwrap();
    (dir, hub)
}
#[test]
fn daily_schedule_and_failure_retry_survive_restart() {
    let (dir, hub) = hub();
    let artist = hub.snapshot().artists[0].clone();
    assert!(artist.due(0, false));
    hub.begin(&artist, DAY).unwrap();
    hub.finish(
        &artist,
        Err("Offline".into()),
        &HashSet::new(),
        |_| panic!(),
    )
    .unwrap();
    let reloaded = ReleaseRadar::new(dir.path().join("radar.json"));
    let artist = reloaded.snapshot().artists[0].clone();
    assert!(!artist.due(DAY + RETRY - 1, false));
    assert!(artist.due(DAY + RETRY, false));
    assert!(!artist.due(DAY + MANUAL_COOLDOWN - 1, true));
    hub.finish(&artist, Ok(catalog()), &HashSet::new(), |_| panic!())
        .unwrap();
    let artist = hub.snapshot().artists[0].clone();
    assert!(!artist.due(DAY * 2 - 1, false));
    assert!(artist.due(DAY * 2, false));
}
#[test]
fn dismissals_dedup_and_auto_add_receipts_survive_restart() {
    let (dir, hub) = hub();
    let artist = hub.snapshot().artists[0].clone();
    hub.finish(&artist, Ok(catalog()), &HashSet::new(), |_| panic!())
        .unwrap();
    hub.dismiss(ALBUM, true).unwrap();
    hub.follow(ID, "Artist", true).unwrap();
    let reloaded = ReleaseRadar::new(dir.path().join("radar.json"));
    reloaded
        .finish(&artist, Ok(catalog()), &HashSet::new(), |_| {
            panic!("Dismissed release must not auto-add")
        })
        .unwrap();
    reloaded.dismiss(ALBUM, false).unwrap();
    let mut added = 0;
    reloaded
        .finish(&artist, Ok(catalog()), &HashSet::new(), |_| {
            added += 1;
            Ok(())
        })
        .unwrap();
    reloaded
        .finish(&artist, Ok(catalog()), &HashSet::new(), |_| {
            panic!("Already added")
        })
        .unwrap();
    assert_eq!(added, 1);
    assert_eq!(reloaded.snapshot().releases.len(), 1);
    assert!(
        ReleaseRadar::new(dir.path().join("radar.json"))
            .snapshot()
            .releases[0]
            .added_to_wanted
    );
}
#[test]
fn unfollow_refollow_and_opt_out_reject_stale_work() {
    let (_dir, hub) = hub();
    let old = hub.snapshot().artists[0].clone();
    hub.unfollow(ID).unwrap();
    hub.follow(ID, "Artist", true).unwrap();
    hub.finish(&old, Ok(catalog()), &HashSet::new(), |_| panic!())
        .unwrap();
    assert!(hub.snapshot().releases.is_empty());
    let current = hub.snapshot().artists[0].clone();
    hub.follow(ID, "Artist", false).unwrap();
    hub.finish(&current, Ok(catalog()), &HashSet::new(), |_| {
        panic!("Opt-out during request")
    })
    .unwrap();
    assert_eq!(hub.snapshot().releases.len(), 1);
}
#[test]
fn owned_releases_and_wrong_artist_are_not_added() {
    let (_dir, hub) = hub();
    hub.follow(ID, "Artist", true).unwrap();
    let artist = hub.snapshot().artists[0].clone();
    let mut wrong = catalog();
    wrong.artist_id = ALBUM.into();
    hub.finish(&artist, Ok(wrong), &HashSet::new(), |_| panic!())
        .unwrap();
    assert!(hub.snapshot().releases.is_empty());
    hub.finish(
        &artist,
        Ok(catalog()),
        &HashSet::from([ALBUM.to_owned()]),
        |_| panic!(),
    )
    .unwrap();
    assert!(hub.snapshot().releases[0].owned);
}
#[test]
fn wanted_failure_keeps_item_reviewable_and_retries() {
    let (_dir, hub) = hub();
    hub.follow(ID, "Artist", true).unwrap();
    let artist = hub.snapshot().artists[0].clone();
    hub.finish(&artist, Ok(catalog()), &HashSet::new(), |_| {
        Err("Wanted is full".into())
    })
    .unwrap();
    assert!(!hub.snapshot().releases[0].added_to_wanted);
    assert!(hub.snapshot().releases[0].auto_add_error.is_some());
    hub.finish(&artist, Ok(catalog()), &HashSet::new(), |_| Ok(()))
        .unwrap();
    assert!(hub.snapshot().releases[0].auto_add_error.is_none());
}

#[test]
fn collaborations_are_one_item_and_keep_decisions_when_one_artist_is_unfollowed() {
    const OTHER: &str = "5441c29d-3602-4898-b1a1-b77fa23b8e51";
    let (dir, hub) = hub();
    let first = hub.snapshot().artists[0].clone();
    hub.finish(&first, Ok(catalog()), &HashSet::new(), |_| panic!())
        .unwrap();
    hub.follow(OTHER, "Collaborator", true).unwrap();
    let second = hub.snapshot().artists[1].clone();
    let mut collaboration = catalog();
    collaboration.artist_id = OTHER.into();
    let mut additions = 0;
    hub.finish(&second, Ok(collaboration), &HashSet::new(), |_| {
        additions += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(additions, 1);
    assert_eq!(hub.snapshot().releases.len(), 1);
    hub.dismiss(ALBUM, true).unwrap();
    hub.unfollow(ID).unwrap();
    let reloaded = ReleaseRadar::new(dir.path().join("radar.json"));
    let release = &reloaded.snapshot().releases[0];
    assert_eq!(release.artist_id, OTHER);
    assert!(release.dismissed && release.added_to_wanted);
}

#[test]
fn unavailable_announcement_is_not_automatically_added_from_old_inbox_data() {
    let (_dir, hub) = hub();
    let artist = hub.snapshot().artists[0].clone();
    hub.finish(&artist, Ok(catalog()), &HashSet::new(), |_| panic!())
        .unwrap();
    hub.follow(ID, "Artist", true).unwrap();
    let mut empty = catalog();
    empty.albums.clear();
    hub.finish(&artist, Ok(empty), &HashSet::new(), |_| {
        panic!("Not in the current provider result")
    })
    .unwrap();
    assert!(!hub.snapshot().releases[0].added_to_wanted);
}
#[test]
fn unsupported_store_is_preserved_and_changes_are_blocked() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("radar.json");
    std::fs::write(&path, br#"{"version":99}"#).unwrap();
    let hub = ReleaseRadar::new(path.clone());
    assert!(hub.follow(ID, "Artist", false).is_err());
    assert!(hub.snapshot().artists.is_empty());
    assert_eq!(std::fs::read(path).unwrap(), br#"{"version":99}"#);
    assert!(!hub.snapshot().notices.is_empty());
}

#[test]
fn failed_save_keeps_memory_unchanged_and_corrupt_primary_recovers_backup() {
    let (dir, hub) = hub();
    let path = dir.path().join("radar.json");
    let artist = hub.snapshot().artists[0].clone();
    hub.finish(&artist, Ok(catalog()), &HashSet::new(), |_| panic!())
        .unwrap();
    hub.dismiss(ALBUM, true).unwrap();
    // A damaged primary recovers the previous valid copy with a visible notice.
    std::fs::write(&path, b"{broken").unwrap();
    let recovered = ReleaseRadar::new(path.clone());
    assert_eq!(recovered.snapshot().artists.len(), 1);
    assert_eq!(recovered.snapshot().releases.len(), 1);
    assert!(!recovered.snapshot().notices.is_empty());
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(recovered.unfollow(ID).is_err());
    assert_eq!(recovered.snapshot().artists.len(), 1);
}
