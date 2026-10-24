//! Reviewed, journaled filing. Originals are retained byte-for-byte until undo.
mod commands;
mod files;
mod tags;
#[cfg(test)]
mod tests;
pub use commands::*;

use super::{
    downloads::{TransferHub, TransferSnapshot, TransferStatus},
    store::{self, JsonFile},
};
use files::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilingSettings {
    pub library_root: String,
    pub naming_template: String,
    pub incomplete_directory: Option<String>,
    pub embed_artwork: bool,
}
impl Default for FilingSettings {
    fn default() -> Self {
        Self {
            library_root: String::new(),
            naming_template: "{albumartist}/{year} - {album}/{disc}{track:02} {title}".into(),
            incomplete_directory: None,
            embed_artwork: false,
        }
    }
}
impl FilingSettings {
    pub fn validate(&self) -> Result<()> {
        validate_template(&self.naming_template)?;
        for path in [
            Some(self.library_root.as_str()).filter(|p| !p.is_empty()),
            self.incomplete_directory.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if path.len() > 180
                || !Path::new(path).is_absolute()
                || path.contains('\0')
                || Path::new(path)
                    .components()
                    .any(|p| matches!(p, std::path::Component::ParentDir))
            {
                return Err(
                    "Choose an absolute library/staging folder (at most 180 characters).".into(),
                );
            }
        }
        if self
            .incomplete_directory
            .as_ref()
            .is_some_and(|p| p.eq_ignore_ascii_case(&self.library_root))
        {
            return Err("The incomplete folder and library root must be separate.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackTags {
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub date: String,
    pub disc: u32,
    pub track: u32,
    pub release_group_id: Option<String>,
    pub release_id: Option<String>,
    pub recording_id: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInput {
    pub transfer_id: String,
    pub tags: TrackTags,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilingRequest {
    pub release_id: String,
    pub settings: FilingSettings,
    pub tracks: Vec<TrackInput>,
    pub artwork_release_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFile {
    pub transfer_id: String,
    pub source: PathBuf,
    pub destination: PathBuf,
    pub backup: PathBuf,
    pub staged: PathBuf,
    pub source_hash: String,
    pub output_hash: Option<String>,
    pub tags: Option<TrackTags>,
    pub before: Vec<(String, String)>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilingPlan {
    pub id: String,
    pub release_id: String,
    pub title: String,
    pub library_root: PathBuf,
    pub album_directory: PathBuf,
    pub stage_directory: PathBuf,
    pub files: Vec<PlannedFile>,
    pub artwork_bytes: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_preview: Option<String>,
    pub warnings: Vec<String>,
    pub beets_command: String,
    #[serde(skip)]
    artwork: Vec<u8>,
    pub(super) originals: Vec<TransferSnapshot>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FilingState {
    Applying,
    Filed,
    Undoing,
    Undone,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilingRecord {
    pub plan: FilingPlan,
    pub state: FilingState,
}
#[derive(Clone, Serialize, Deserialize)]
struct Journal {
    version: u32,
    records: Vec<FilingRecord>,
}
impl Default for Journal {
    fn default() -> Self {
        Self {
            version: 1,
            records: vec![],
        }
    }
}
struct Engine {
    file: JsonFile,
    journal: Journal,
    previews: HashMap<String, FilingPlan>,
}
#[derive(Clone)]
pub struct FilingHub {
    engine: Arc<Mutex<Engine>>,
    transfers: TransferHub,
}

impl FilingHub {
    pub fn new(path: PathBuf, transfers: TransferHub) -> Self {
        let file = JsonFile::new(path);
        let journal: Journal =
            file.load(Journal::default, |bytes| store::decode(bytes, 1, None, &[]));
        for record in &journal.records {
            if record.state != FilingState::Undone {
                transfers.hold_filing(&record.plan.release_id);
            }
        }
        Self {
            engine: Arc::new(Mutex::new(Engine {
                file,
                journal,
                previews: HashMap::new(),
            })),
            transfers,
        }
    }
    pub fn history(&self) -> Result<Vec<FilingRecord>> {
        let engine = self.engine.lock().map_err(err)?;
        if engine.file.is_blocked() {
            return Err("Filing journal is unavailable; its files have been preserved. Restart after resolving the storage problem.".into());
        }
        Ok(engine.journal.records.clone())
    }
    pub fn notices(&self) -> Result<Vec<super::store::StoreNotice>> {
        Ok(self.engine.lock().map_err(err)?.file.notices())
    }
    pub fn preview(&self, request: FilingRequest, artwork: Vec<u8>) -> Result<FilingPlan> {
        let mut engine = self.engine.lock().map_err(err)?;
        if engine.file.is_blocked() {
            return Err("Filing journal is unavailable.".into());
        }
        if engine
            .journal
            .records
            .iter()
            .any(|r| r.plan.release_id == request.release_id && r.state != FilingState::Undone)
        {
            return Err(
                "This arrival already has a filing operation. Review its history or undo first."
                    .into(),
            );
        }
        let transfers = self
            .transfers
            .snapshot()
            .transfers
            .into_iter()
            .filter(|t| t.release_id.as_deref() == Some(&request.release_id))
            .collect();
        let plan = make_plan(request, transfers, artwork)?;
        if engine.previews.len() >= 8 {
            engine.previews.clear();
        }
        engine.previews.insert(plan.id.clone(), plan.clone());
        Ok(plan)
    }
    pub fn apply(&self, id: &str) -> Result<FilingRecord> {
        let mut engine = self.engine.lock().map_err(err)?;
        let _operation = self
            .transfers
            .file_operations
            .try_lock()
            .map_err(|_| "Another file operation is running. Try again when it finishes.")?;
        let plan = engine
            .previews
            .remove(id)
            .ok_or("Preview expired. Preview this arrival again.")?;
        if engine
            .journal
            .records
            .iter()
            .any(|r| r.plan.release_id == plan.release_id && r.state != FilingState::Undone)
        {
            return Err("An operation already exists for this arrival.".into());
        }
        let current = self.transfers.snapshot();
        for original in &plan.originals {
            if !current.transfers.iter().any(|t| {
                t.id == original.id
                    && t.local_path == original.local_path
                    && t.status == TransferStatus::Completed
                    && t.updated_at_ms == original.updated_at_ms
            }) {
                return Err("The arrival changed. Preview again before filing.".into());
            }
        }
        preflight(&plan)?;
        let mut plan = plan;
        plan.artwork_preview = None;
        let record = FilingRecord {
            plan,
            state: FilingState::Applying,
        };
        let index = engine.journal.records.len();
        engine.journal.records.push(record);
        if let Err(error) = engine.save() {
            engine.journal.records.pop();
            return Err(error);
        }
        self.transfers
            .hold_filing(&engine.journal.records[index].plan.release_id);
        // Save output hashes before publishing anything. A failed/interrupted apply
        // stays in history and can always be reviewed and rolled back explicitly.
        let result = (|| {
            let staged = stage(&mut engine.journal.records[index].plan);
            engine.journal.records[index].plan.artwork.clear();
            staged?;
            engine.save()?;
            publish(&engine.journal.records[index].plan)?;
            self.transfers
                .commit_filing(&engine.journal.records[index].plan, false)?;
            engine.journal.records[index].state = FilingState::Filed;
            if let Err(error) = engine.save() {
                engine.journal.records[index].state = FilingState::Applying;
                return Err(error);
            }
            Ok(engine.journal.records[index].clone())
        })();
        result.map_err(|e: String| format!("Filing stopped: {e} Originals are retained. Open Filing history to review and undo this operation."))
    }
    pub fn undo(&self, id: &str) -> Result<FilingRecord> {
        let mut engine = self.engine.lock().map_err(err)?;
        let _operation = self
            .transfers
            .file_operations
            .try_lock()
            .map_err(|_| "Another file operation is running.")?;
        let index = engine
            .journal
            .records
            .iter()
            .position(|r| r.plan.id == id)
            .ok_or("Filing operation not found.")?;
        if engine.journal.records[index].state == FilingState::Undone {
            return Ok(engine.journal.records[index].clone());
        }
        check_undo(&engine.journal.records[index].plan)?;
        engine.journal.records[index].state = FilingState::Undoing;
        engine.save()?;
        rollback(&engine.journal.records[index].plan)?;
        self.transfers
            .commit_filing(&engine.journal.records[index].plan, true)?;
        engine.journal.records[index].state = FilingState::Undone;
        if let Err(error) = engine.save() {
            engine.journal.records[index].state = FilingState::Undoing;
            return Err(error);
        }
        self.transfers
            .release_filing(&engine.journal.records[index].plan.release_id);
        Ok(engine.journal.records[index].clone())
    }
}
impl Engine {
    fn save(&self) -> Result<()> {
        self.file.save(&self.journal).map_err(err)
    }
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn make_plan(
    request: FilingRequest,
    originals: Vec<TransferSnapshot>,
    artwork: Vec<u8>,
) -> Result<FilingPlan> {
    request.settings.validate()?;
    if originals.is_empty()
        || originals.len() > 500
        || originals
            .iter()
            .any(|t| t.status != TransferStatus::Completed)
    {
        return Err("Choose a completed album with at most 500 files.".into());
    }
    let root = PathBuf::from(&request.settings.library_root);
    safe_path(&root)?;
    if !root.is_dir() {
        return Err("Choose an existing library root folder.".into());
    }
    let root = root.canonicalize().map_err(err)?;
    let id = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(err)?
            .as_nanos()
    );
    let stage_directory = root.join(format!(".forever-filing-{id}"));
    let mut positions = HashSet::new();
    let mut mappings = HashMap::new();
    for track in request.tracks {
        if !positions.insert((track.tags.disc, track.tags.track))
            || mappings.contains_key(&track.transfer_id)
        {
            return Err("Assign each file and disc/track position exactly once.".into());
        }
        if request.settings.embed_artwork && track.tags.release_id != request.artwork_release_id {
            return Err(
                "Map every track to the chosen artwork edition before embedding its cover.".into(),
            );
        }
        mappings.insert(track.transfer_id, track.tags);
    }
    let mut files = Vec::new();
    let mut destinations = HashSet::new();
    let mut sources = HashSet::new();
    for (index, original) in originals.iter().enumerate() {
        let source = PathBuf::from(&original.local_path);
        safe_path(&source)?;
        let source = source.canonicalize().map_err(err)?;
        if !sources.insert(source.to_string_lossy().to_lowercase()) {
            return Err("This arrival references the same source file more than once.".into());
        }
        if !source.is_file()
            || std::fs::metadata(&source).map_err(err)?.len() != original.size_bytes
        {
            return Err(format!(
                "{} is missing or its size changed. Verify it first.",
                source.display()
            ));
        }
        let tags = mappings.remove(&original.id);
        if is_audio(&source) && tags.is_none() {
            return Err(format!(
                "Map every audio file before preview: {}",
                source.display()
            ));
        }
        if !is_audio(&source) && tags.is_some() {
            return Err("Tags can only be assigned to audio files.".into());
        }
        let before = if let Some(tags) = &tags {
            validate_tags(tags)?;
            tags::read_tags(&source)?
        } else {
            vec![]
        };
        let extension = source.extension().and_then(|s| s.to_str()).unwrap_or("");
        let destination = match &tags {
            Some(tags) => root.join(format!(
                "{}.{}",
                render_template(&request.settings.naming_template, tags)?,
                extension
            )),
            None => PathBuf::new(),
        };
        files.push(PlannedFile {
            transfer_id: original.id.clone(),
            source: source.clone(),
            destination,
            backup: source.with_file_name(format!(".forever-undo-{id}-{index}.{extension}")),
            staged: stage_directory.join(format!("{index}.{extension}")),
            source_hash: hash(&source)?,
            output_hash: None,
            tags,
            before,
        });
    }
    if !mappings.is_empty() {
        return Err("The track mapping contains files outside this arrival.".into());
    }
    let mut album_directory = files
        .iter()
        .find(|f| f.tags.is_some())
        .and_then(|f| f.destination.parent())
        .ok_or("No supported audio tracks to file.")?
        .to_path_buf();
    for file in files.iter().filter(|f| f.tags.is_some()) {
        while !file.destination.starts_with(&album_directory) {
            if !album_directory.pop() {
                return Err("No common album directory.".into());
            }
        }
    }
    if album_directory == root {
        return Err(
            "The naming template must keep this album in its own folder beneath the library root."
                .into(),
        );
    }
    for file in &mut files {
        if file.tags.is_none() {
            // Preserve companion subfolders relative to the downloaded album.
            let base = originals[0]
                .release_folder
                .as_deref()
                .map(Path::new)
                .and_then(|p| p.canonicalize().ok());
            let relative = base
                .as_ref()
                .and_then(|b| file.source.strip_prefix(b).ok())
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(file.source.file_name().unwrap_or_default()));
            file.destination = album_directory.join(relative);
        }
        if !destinations.insert(file.destination.to_string_lossy().to_lowercase()) {
            return Err("The naming template creates duplicate destinations (including case-only differences).".into());
        }
        if file.destination.to_string_lossy().len() > 240 {
            return Err(
                "A destination path exceeds 240 characters. Shorten the template or library root."
                    .into(),
            );
        }
    }
    let beets_command = format!(
        "beet import -t -- '{}'",
        album_directory.to_string_lossy().replace('\'', "''")
    );
    use base64::Engine;
    let artwork_preview = if artwork.is_empty() {
        None
    } else {
        let picture = lofty::picture::Picture::from_reader(&mut std::io::Cursor::new(&artwork))
            .map_err(err)?;
        Some(format!(
            "data:{};base64,{}",
            picture
                .mime_type()
                .ok_or("Artwork has no supported image type.")?
                .as_str(),
            base64::engine::general_purpose::STANDARD.encode(&artwork)
        ))
    };
    let plan = FilingPlan { id, release_id: request.release_id, title: originals[0].release_title.clone().unwrap_or_default(), library_root: root, album_directory, stage_directory, files, artwork_bytes: artwork.len(), artwork_preview, artwork, originals, beets_command, warnings: vec!["Review every file-to-track mapping. Existing tags can be wrong; filenames do not prove recording identity.".into(), "Original files are retained beside the download in .forever-undo files, using extra disk space until you undo. Music Library is not imported automatically.".into()] };
    preflight(&plan)?;
    Ok(plan)
}
