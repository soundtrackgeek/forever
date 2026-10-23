use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
    time::UNIX_EPOCH,
};
use symphonia::{
    core::{
        formats::{probe::Hint, FormatOptions, TrackType},
        io::{MediaSource, MediaSourceStream},
        meta::MetadataOptions,
        units::Timestamp,
    },
    default,
};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct AudioQuality {
    pub bitrate: Option<u32>,
    pub duration_seconds: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
}

// A probe may seek to container tails, but cannot read an entire large or
// malformed release. Never decode audio or write to the source file.
struct HeaderSource {
    file: fs::File,
    remaining: usize,
}
impl Read for HeaderSource {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            return Err(io::Error::other("Audio header read budget exceeded"));
        }
        let limit = buffer.len().min(self.remaining);
        let read = self.file.read(&mut buffer[..limit])?;
        self.remaining -= read;
        Ok(read)
    }
}
impl Seek for HeaderSource {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.file.seek(position)
    }
}
impl MediaSource for HeaderSource {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        self.file.metadata().ok().map(|m| m.len())
    }
}

fn probe(path: &Path, size: u64) -> Option<AudioQuality> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if ![
        "aac", "aif", "aiff", "alac", "caf", "flac", "m4a", "mp3", "mp4", "ogg", "oga", "opus",
        "wav",
    ]
    .contains(&extension.as_str())
    {
        return None;
    }
    let source = HeaderSource {
        file: fs::File::open(path).ok()?,
        remaining: 8 * 1024 * 1024,
    };
    let mut hint = Hint::new();
    hint.with_extension(&extension);
    let format = default::get_probe()
        .probe(
            &hint,
            MediaSourceStream::new(Box::new(source), Default::default()),
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .ok()?;
    let track = format.default_track(TrackType::Audio)?;
    let audio = track.codec_params.as_ref()?.audio()?;
    let seconds = track
        .time_base
        .zip(track.duration)
        .and_then(|(base, duration)| {
            i64::try_from(duration.get())
                .ok()
                .map(Timestamp::new)
                .and_then(|ts| base.calc_time(ts))
        })
        .map(|time| time.as_secs_f64())
        .or_else(|| {
            audio
                .sample_rate
                .zip(track.num_frames)
                .and_then(|(rate, frames)| (rate > 0).then_some(frames as f64 / f64::from(rate)))
        })
        .filter(|v| v.is_finite() && *v > 0.0 && *v <= f64::from(u32::MAX));
    Some(AudioQuality {
        // Symphonia does not expose a nominal bitrate: this is the average
        // container bitrate, including tags/artwork, when duration is known.
        bitrate: seconds
            .map(|seconds| (size as f64 * 8.0 / seconds / 1000.0).round())
            .filter(|v| *v > 0.0 && *v <= f64::from(u32::MAX))
            .map(|v| v as u32),
        duration_seconds: seconds.map(|v| v.round().max(1.0) as u32),
        sample_rate: audio.sample_rate.filter(|v| *v > 0),
        bit_depth: audio
            .bits_per_coded_sample
            .or(audio.bits_per_sample)
            .filter(|v| *v > 0),
    })
}

fn modified_key(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|time| time.as_nanos().to_string())
}

pub(super) struct IndexCache {
    db: Option<Connection>,
    pub error: Option<String>,
    pub reused: u32,
    pub inspected: u32,
}
impl IndexCache {
    pub fn open(path: &Path) -> Self {
        let result = (|| -> rusqlite::Result<Connection> {
            let db = Connection::open(path)?;
            db.busy_timeout(std::time::Duration::from_secs(2))?;
            let version: u32 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            if version > 1 {
                return Err(rusqlite::Error::InvalidQuery);
            }
            db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, size TEXT NOT NULL, mtime TEXT NOT NULL, quality TEXT NOT NULL);
                PRAGMA user_version=1; BEGIN IMMEDIATE;
                CREATE TEMP TABLE live_paths (path TEXT PRIMARY KEY);")?;
            Ok(db)
        })();
        match result {
            Ok(db) => Self {
                db: Some(db),
                error: None,
                reused: 0,
                inspected: 0,
            },
            Err(error) => Self {
                db: None,
                error: Some(format!(
                    "Share cache unavailable; headers will be read again: {error}"
                )),
                reused: 0,
                inspected: 0,
            },
        }
    }

    pub fn quality(&mut self, path: &Path, metadata: &fs::Metadata) -> AudioQuality {
        let key = path.to_string_lossy();
        let mtime = modified_key(metadata);
        if let (Some(db), Some(mtime)) = (&self.db, &mtime) {
            let result = (|| -> rusqlite::Result<Option<String>> {
                db.prepare_cached(
                    "SELECT quality FROM files WHERE path=?1 AND size=?2 AND mtime=?3",
                )?
                .query_row(params![key, metadata.len().to_string(), mtime], |row| {
                    row.get(0)
                })
                .optional()
            })();
            match result {
                Ok(Some(json)) => {
                    if let Ok(quality) = serde_json::from_str(&json) {
                        self.reused += 1;
                        return quality;
                    }
                }
                Err(error) => self.error = Some(format!("Share cache read failed: {error}")),
                _ => {}
            }
        }
        self.inspected += 1;
        let quality = probe(path, metadata.len()).unwrap_or_default();
        // A file still being copied/tagged must be inspected again next time.
        let stable = fs::metadata(path)
            .ok()
            .is_some_and(|after| after.len() == metadata.len() && modified_key(&after) == mtime);
        if let (Some(db), Some(mtime), true) = (&self.db, mtime, stable) {
            let result = (|| -> rusqlite::Result<()> {
                db.prepare_cached("INSERT INTO files VALUES (?1,?2,?3,?4) ON CONFLICT(path) DO UPDATE SET size=excluded.size,mtime=excluded.mtime,quality=excluded.quality")?
                    .execute(params![key, metadata.len().to_string(), mtime, serde_json::to_string(&quality).unwrap()])?;
                Ok(())
            })();
            if let Err(error) = result {
                self.error = Some(format!("Share cache write failed: {error}"));
            }
        }
        quality
    }

    pub fn finish<'a>(&mut self, paths: impl Iterator<Item = &'a Path>) {
        if let Some(db) = &self.db {
            let result = (|| -> rusqlite::Result<()> {
                let mut insert =
                    db.prepare_cached("INSERT OR IGNORE INTO live_paths VALUES (?1)")?;
                for path in paths {
                    insert.execute([path.to_string_lossy()])?;
                }
                db.execute_batch(
                    "DELETE FROM files WHERE path NOT IN (SELECT path FROM live_paths); COMMIT;",
                )
            })();
            if let Err(error) = result {
                self.error = Some(format!("Share cache save failed: {error}"));
            }
        }
    }
}
