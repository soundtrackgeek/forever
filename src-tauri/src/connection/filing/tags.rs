use super::*;
use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    picture::{Picture, PictureType},
    prelude::{Accessor, ItemKey},
    tag::Tag,
};

fn read(path: &Path) -> Result<lofty::file::TaggedFile> {
    let file =
        lofty::read_from_path(path).map_err(|e| format!("Cannot tag {}: {e}", path.display()))?;
    // Explicit formats whose primary tags can represent the complete preview.
    use lofty::file::FileType;
    if !matches!(
        file.file_type(),
        FileType::Mpeg
            | FileType::Flac
            | FileType::Mp4
            | FileType::Vorbis
            | FileType::Opus
            | FileType::Wav
            | FileType::Aiff
            | FileType::Ape
            | FileType::WavPack
    ) {
        return Err(format!(
            "Tag writing is not supported for {}. Keep this arrival in the download folder.",
            path.display()
        ));
    }
    Ok(file)
}
pub(super) fn read_tags(path: &Path) -> Result<Vec<(String, String)>> {
    let file = read(path)?;
    let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) else {
        return Ok(vec![]);
    };
    Ok([
        ("Title", tag.title().map(|s| s.into_owned())),
        ("Artist", tag.artist().map(|s| s.into_owned())),
        (
            "Album artist",
            tag.get_string(ItemKey::AlbumArtist).map(str::to_owned),
        ),
        ("Album", tag.album().map(|s| s.into_owned())),
        (
            "Date",
            tag.get_string(ItemKey::RecordingDate).map(str::to_owned),
        ),
        ("Disc", tag.disk().map(|s| s.to_string())),
        ("Track", tag.track().map(|s| s.to_string())),
        (
            "Release group MBID",
            tag.get_string(ItemKey::MusicBrainzReleaseGroupId)
                .map(str::to_owned),
        ),
        (
            "Release MBID",
            tag.get_string(ItemKey::MusicBrainzReleaseId)
                .map(str::to_owned),
        ),
        (
            "Recording MBID",
            tag.get_string(ItemKey::MusicBrainzRecordingId)
                .map(str::to_owned),
        ),
        (
            "Artwork",
            Some(format!("{} embedded images", tag.pictures().len())),
        ),
    ]
    .into_iter()
    .filter_map(|(k, v)| v.map(|v| (k.into(), v)))
    .collect())
}
pub(super) fn write_tags(path: &Path, values: &TrackTags, artwork: &[u8]) -> Result<()> {
    let mut file = read(path)?;
    let tag_type = file.primary_tag_type();
    if file.primary_tag().is_none() {
        file.insert_tag(Tag::new(tag_type));
    }
    let tag = file.primary_tag_mut().ok_or("No writable primary tag.")?;
    tag.set_title(values.title.clone());
    tag.set_artist(values.artist.clone());
    tag.set_album(values.album.clone());
    tag.set_track(values.track);
    tag.set_disk(values.disc);
    for (key, value) in [
        (ItemKey::AlbumArtist, Some(values.album_artist.as_str())),
        (
            ItemKey::RecordingDate,
            Some(values.date.as_str()).filter(|s| !s.is_empty()),
        ),
        (
            ItemKey::MusicBrainzReleaseGroupId,
            values.release_group_id.as_deref(),
        ),
        (ItemKey::MusicBrainzReleaseId, values.release_id.as_deref()),
        (
            ItemKey::MusicBrainzRecordingId,
            values.recording_id.as_deref(),
        ),
    ] {
        tag.remove_key(key);
        if let Some(value) = value {
            tag.insert_text(key, value.into());
        }
    }
    if !artwork.is_empty() {
        let mut picture = Picture::from_reader(&mut std::io::Cursor::new(artwork)).map_err(err)?;
        picture.set_pic_type(PictureType::CoverFront);
        // Preserve booklets/back covers; replace only the front image.
        let front: Vec<_> = tag
            .pictures()
            .iter()
            .enumerate()
            .filter(|(_, p)| p.pic_type() == PictureType::CoverFront)
            .map(|(i, _)| i)
            .collect();
        for index in front.into_iter().rev() {
            tag.remove_picture(index);
        }
        tag.push_picture(picture);
    }
    file.save_to_path(path, WriteOptions::default())
        .map_err(err)?;
    // Read back critical values instead of assuming the container accepted them.
    let verified = read(path)?;
    let tag = verified
        .primary_tag()
        .ok_or("Saved tags could not be read back.")?;
    if tag.title().as_deref() != Some(&values.title)
        || tag.artist().as_deref() != Some(&values.artist)
        || tag.album().as_deref() != Some(&values.album)
        || tag.get_string(ItemKey::AlbumArtist) != Some(&values.album_artist)
        || tag.track() != Some(values.track)
        || tag.disk() != Some(values.disc)
    {
        return Err(
            "The audio container did not retain all reviewed tags; originals are unchanged.".into(),
        );
    }
    for (key, expected) in [
        (
            ItemKey::RecordingDate,
            Some(values.date.as_str()).filter(|s| !s.is_empty()),
        ),
        (
            ItemKey::MusicBrainzReleaseGroupId,
            values.release_group_id.as_deref(),
        ),
        (ItemKey::MusicBrainzReleaseId, values.release_id.as_deref()),
        (
            ItemKey::MusicBrainzRecordingId,
            values.recording_id.as_deref(),
        ),
    ] {
        if tag.get_string(key) != expected {
            return Err(format!(
                "The container did not retain the reviewed {key:?} value."
            ));
        }
    }
    if !artwork.is_empty()
        && !tag
            .pictures()
            .iter()
            .any(|p| p.pic_type() == PictureType::CoverFront && p.data() == artwork)
    {
        return Err("Embedded artwork failed read-back verification.".into());
    }
    Ok(())
}
