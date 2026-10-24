use super::*;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Component,
};

pub(super) fn safe_path(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Filing requires absolute paths without parent traversal.".into());
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err(format!(
                            "Links and junctions are not supported: {}",
                            ancestor.display()
                        ));
                    }
                }
                if metadata.file_type().is_symlink() {
                    return Err(format!("Links are not supported: {}", ancestor.display()));
                }
                if ancestor != path && !metadata.is_dir() {
                    return Err(format!(
                        "A parent is not a directory: {}",
                        ancestor.display()
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(err(e)),
        }
    }
    Ok(())
}
pub(super) fn hash(path: &Path) -> Result<String> {
    safe_path(path)?;
    let mut input = fs::File::open(path).map_err(err)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let n = input.read(&mut buffer).map_err(err)?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn unchanged(path: &Path, expected: &str) -> Result<()> {
    if hash(path)? != expected {
        return Err(format!("File changed since review: {}", path.display()));
    }
    Ok(())
}
pub(super) fn preflight(plan: &FilingPlan) -> Result<()> {
    safe_path(&plan.library_root)?;
    safe_path(&plan.stage_directory)?;
    if plan.stage_directory.exists() {
        return Err("The staging directory already exists. Preview again.".into());
    }
    for file in &plan.files {
        safe_path(&file.destination)?;
        safe_path(&file.backup)?;
        if !file.destination.starts_with(&plan.library_root)
            || file.destination.exists()
            || file.backup.exists()
        {
            return Err(format!(
                "Destination or undo file already exists: {}",
                file.destination.display()
            ));
        }
        unchanged(&file.source, &file.source_hash)?;
    }
    Ok(())
}
pub(super) fn stage(plan: &mut FilingPlan) -> Result<()> {
    fs::create_dir(&plan.stage_directory).map_err(err)?;
    for file in &mut plan.files {
        let mut target = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file.staged)
            .map_err(err)?;
        let mut source = fs::File::open(&file.source).map_err(err)?;
        std::io::copy(&mut source, &mut target).map_err(err)?;
        target.flush().map_err(err)?;
        target.sync_all().map_err(err)?;
        drop(target);
        unchanged(&file.staged, &file.source_hash)?;
        if let Some(tags) = &file.tags {
            tags::write_tags(&file.staged, tags, &plan.artwork)?;
        }
        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&file.staged)
            .map_err(err)?
            .sync_all()
            .map_err(err)?;
        file.output_hash = Some(hash(&file.staged)?);
    }
    Ok(())
}
pub(super) fn publish(plan: &FilingPlan) -> Result<()> {
    // Validate the whole album again before the first visible change.
    for file in &plan.files {
        unchanged(&file.source, &file.source_hash)?;
        safe_path(&file.destination)?;
        if file.destination.exists() || file.backup.exists() {
            return Err("A destination appeared after preview.".into());
        }
    }
    for file in &plan.files {
        safe_path(&file.destination)?;
        fs::create_dir_all(
            file.destination
                .parent()
                .ok_or("Missing destination parent.")?,
        )
        .map_err(err)?;
        // Atomic create-if-absent publication. Never rename over an existing file.
        move_new(&file.staged, &file.destination)?;
    }
    for file in &plan.files {
        unchanged(&file.source, &file.source_hash)?;
        safe_path(&file.backup)?;
        move_new(&file.source, &file.backup)?;
    }
    fs::remove_dir(&plan.stage_directory).map_err(err)?;
    Ok(())
}
pub(super) fn check_undo(plan: &FilingPlan) -> Result<()> {
    for file in &plan.files {
        for path in [&file.source, &file.backup, &file.destination, &file.staged] {
            safe_path(path)?;
        }
        if file.source.exists() {
            unchanged(&file.source, &file.source_hash)?;
        }
        if file.backup.exists() {
            unchanged(&file.backup, &file.source_hash)?;
        }
        if !file.source.exists() && !file.backup.exists() {
            return Err(format!(
                "Original and undo copy are both missing: {}",
                file.source.display()
            ));
        }
        if file.destination.exists() {
            unchanged(&file.destination, file.output_hash.as_deref().ok_or("An unrecognized destination exists; preserve it and resolve the conflict before undo.")?)?;
        }
    }
    Ok(())
}
pub(super) fn rollback(plan: &FilingPlan) -> Result<()> {
    check_undo(plan)?;
    for file in &plan.files {
        if !file.source.exists() {
            fs::create_dir_all(file.source.parent().ok_or("Missing original parent.")?)
                .map_err(err)?;
            move_new(&file.backup, &file.source)?;
        }
        unchanged(&file.source, &file.source_hash)?;
        if file.destination.exists() {
            unchanged(
                &file.destination,
                file.output_hash
                    .as_deref()
                    .ok_or("Missing output fingerprint.")?,
            )?;
            fs::remove_file(&file.destination).map_err(err)?;
        }
        if file.backup.exists() {
            unchanged(&file.backup, &file.source_hash)?;
            fs::remove_file(&file.backup).map_err(err)?;
        }
        // Incomplete staging copies belong to this exclusive transaction directory.
        if file.staged.exists() {
            safe_path(&file.staged)?;
            fs::remove_file(&file.staged).map_err(err)?;
        }
    }
    if plan.stage_directory.exists() {
        fs::remove_dir(&plan.stage_directory).map_err(err)?;
    }
    // Empty library directories are harmless and may predate this operation.
    Ok(())
}

// Windows rename without REPLACE_EXISTING: the destination must be absent.
// Each move stays on one volume; the initial staged copy supports different
// download/library volumes without relying on hard-link support (e.g. exFAT).
#[cfg(windows)]
fn move_new(from: &Path, to: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<_> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<_> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both buffers are NUL-terminated and live for the synchronous call.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 8) } == 0 {
        return Err(err(std::io::Error::last_os_error()));
    }
    Ok(())
}
#[cfg(not(windows))]
fn move_new(from: &Path, to: &Path) -> Result<()> {
    fs::hard_link(from, to).map_err(err)?;
    fs::remove_file(from).map_err(err)
}

const TOKENS: [&str; 8] = [
    "albumartist",
    "artist",
    "year",
    "album",
    "disc",
    "track",
    "track:02",
    "title",
];
pub(super) fn validate_template(template: &str) -> Result<()> {
    if template.is_empty()
        || template.len() > 300
        || template.starts_with('/')
        || template.contains('\\')
        || !template.contains('/')
    {
        return Err("Use a relative naming template with / between folders.".into());
    }
    let mut remaining = template.to_owned();
    for token in TOKENS {
        remaining = remaining.replace(&format!("{{{token}}}"), "value");
    }
    if remaining.contains(['{', '}', ':', '*', '?', '"', '<', '>', '|'])
        || remaining.chars().any(char::is_control)
        || remaining
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(
            "The naming template contains an unknown token or unsafe path component.".into(),
        );
    }
    Ok(())
}
fn component(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    if cleaned.is_empty() {
        "Unknown".into()
    } else if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.ends_with(['1', '2', '3', '4', '5', '6', '7', '8', '9']))
    {
        format!("_{cleaned}")
    } else {
        cleaned.into()
    }
}
pub(super) fn render_template(template: &str, tags: &TrackTags) -> Result<String> {
    validate_template(template)?;
    let values = [
        &tags.album_artist,
        &tags.artist,
        tags.date.get(..4).unwrap_or("Unknown"),
        &tags.album,
        &tags.disc.to_string(),
        &tags.track.to_string(),
        &format!("{:02}", tags.track),
        &tags.title,
    ];
    let mut result = template.to_owned();
    for (token, value) in TOKENS.into_iter().zip(values) {
        result = result.replace(&format!("{{{token}}}"), &component(value));
    }
    Ok(result
        .split('/')
        .map(component)
        .collect::<Vec<_>>()
        .join("/"))
}
pub(super) fn validate_tags(tags: &TrackTags) -> Result<()> {
    if [&tags.title, &tags.artist, &tags.album_artist, &tags.album]
        .iter()
        .any(|v| v.trim().is_empty() || v.len() > 1000 || v.chars().any(char::is_control))
        || tags.disc == 0
        || tags.track == 0
        || tags.disc > 999
        || tags.track > 999
    {
        return Err("Every track needs a title, artist, album artist, album, and disc/track numbers from 1 to 999.".into());
    }
    if !tags.date.is_empty()
        && (![4, 7, 10].contains(&tags.date.len())
            || !tags.date.bytes().enumerate().all(|(i, b)| {
                if i == 4 || i == 7 {
                    b == b'-'
                } else {
                    b.is_ascii_digit()
                }
            }))
    {
        return Err("Date must be blank, YYYY, YYYY-MM, or YYYY-MM-DD.".into());
    }
    for id in [&tags.release_group_id, &tags.release_id, &tags.recording_id]
        .into_iter()
        .flatten()
    {
        if !crate::musicbrainz::is_musicbrainz_id(id) {
            return Err("Invalid MusicBrainz ID.".into());
        }
    }
    Ok(())
}
pub(super) fn is_audio(path: &Path) -> bool {
    super::super::soundcheck::is_audio_path(path)
}
