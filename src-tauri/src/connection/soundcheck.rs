use serde::{Deserialize, Serialize};
pub mod sonic;
use sonic::{Analyzer, SonicEvidence};
use std::{
    fs::File,
    path::Path,
    sync::{Mutex, OnceLock},
};
use symphonia::{
    core::{
        codecs::{
            audio::{
                well_known::{
                    CODEC_ID_AAC, CODEC_ID_ALAC, CODEC_ID_FLAC, CODEC_ID_MP3, CODEC_ID_OPUS,
                    CODEC_ID_PCM_F64BE_PLANAR, CODEC_ID_PCM_S32LE, CODEC_ID_VORBIS,
                },
                AudioCodecId, AudioDecoderOptions,
            },
            registry::CodecRegistry,
        },
        errors::Error as SymphoniaError,
        formats::{probe::Hint, FormatOptions, TrackType},
        io::MediaSourceStream,
        meta::{MetadataOptions, StandardTag},
        units::Timestamp,
    },
    default,
};

const AUDIO_EXTENSIONS: [&str; 16] = [
    "aac", "aif", "aiff", "alac", "ape", "caf", "flac", "m4a", "mp3", "mp4", "ogg", "opus", "wav",
    "wma", "wv", "oga",
];
const PROBED_EXTENSIONS: [&str; 12] = [
    "aac", "aif", "aiff", "alac", "caf", "flac", "m4a", "mp3", "mp4", "ogg", "opus", "wav",
];

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SoundcheckStatus {
    #[default]
    Pending,
    Passed,
    Review,
    Failed,
    Unsupported,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundcheckResult {
    pub status: SoundcheckStatus,
    pub checked_at_ms: u64,
    pub deep: bool,
    pub codec: Option<String>,
    pub container: Option<String>,
    pub duration_seconds: Option<f64>,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bits_per_sample: Option<u32>,
    pub channels: Option<u32>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub issues: Vec<String>,
    #[serde(default)]
    pub sonic: Option<SonicEvidence>,
    #[serde(default)]
    pub source_stamp: Option<SourceStamp>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStamp {
    pub size_bytes: u64,
    pub modified_at_ns: Option<String>,
}

pub fn source_stamp(path: &Path) -> Option<SourceStamp> {
    std::fs::metadata(path).ok().map(|m| SourceStamp {
        size_bytes: m.len(),
        modified_at_ns: m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos().to_string()),
    })
}

impl SoundcheckResult {
    pub fn repairable(&self) -> bool {
        self.status == SoundcheckStatus::Failed
            || self.sonic.as_ref().is_some_and(SonicEvidence::needs_review)
    }
}

pub fn is_audio_path(path: &Path) -> bool {
    extension(path).is_some_and(|extension| AUDIO_EXTENSIONS.contains(&extension.as_str()))
}

pub fn inspect_file(path: &Path, deep: bool, checked_at_ms: u64) -> Option<SoundcheckResult> {
    if !is_audio_path(path) {
        return None;
    }
    let extension = extension(path).unwrap_or_default();
    if !PROBED_EXTENSIONS.contains(&extension.as_str()) {
        return Some(SoundcheckResult {
            status: SoundcheckStatus::Unsupported,
            checked_at_ms,
            deep,
            container: Some(extension.to_ascii_uppercase()),
            issues: vec![format!(
                "{} audio is recognized, but this Soundcheck version cannot inspect it yet.",
                extension.to_ascii_uppercase()
            )],
            ..Default::default()
        });
    }

    match inspect_probed_file(path, &extension, deep, checked_at_ms) {
        Ok(result) => Some(result),
        Err(message) => Some(SoundcheckResult {
            status: SoundcheckStatus::Failed,
            checked_at_ms,
            deep,
            container: Some(extension.to_ascii_uppercase()),
            issues: vec![message],
            ..Default::default()
        }),
    }
}

fn inspect_probed_file(
    path: &Path,
    extension: &str,
    deep: bool,
    checked_at_ms: u64,
) -> Result<SoundcheckResult, String> {
    static DEEP_SCAN: Mutex<()> = Mutex::new(());
    let _deep_guard = deep.then(|| DEEP_SCAN.lock().unwrap_or_else(|p| p.into_inner()));
    let source = File::open(path)
        .map_err(|error| format!("Forever could not open this audio file: {error}"))?;
    let stream = MediaSourceStream::new(Box::new(source), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let mut format = default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|error| format!("The audio container could not be read: {error}"))?;

    let track = format
        .default_track(TrackType::Audio)
        .cloned()
        .ok_or_else(|| "No readable audio stream was found in this file.".to_owned())?;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
        .cloned()
        .ok_or_else(|| "The file did not report usable audio codec parameters.".to_owned())?;
    let registration = codecs().get_audio_decoder(params.codec);
    let codec_name = registration
        .map(|registration| registration.codec.info.short_name)
        .unwrap_or_else(|| codec_fallback_name(params.codec, extension));
    let codec = codec_name.to_ascii_uppercase();
    let duration_seconds = track
        .time_base
        .zip(track.duration)
        .and_then(|(time_base, duration)| {
            i64::try_from(duration.get())
                .ok()
                .map(Timestamp::new)
                .and_then(|duration| time_base.calc_time(duration))
        })
        .map(|time| time.as_secs_f64())
        .filter(|duration| *duration > 0.0)
        .or_else(|| {
            params
                .sample_rate
                .zip(track.num_frames)
                .and_then(|(sample_rate, frames)| {
                    (sample_rate > 0).then_some(frames as f64 / f64::from(sample_rate))
                })
        });
    let mut track_number = None;
    let mut track_total = None;
    if let Some(revision) = format.metadata().skip_to_latest() {
        for tag in &revision.media.tags {
            match tag.std.as_ref() {
                Some(StandardTag::TrackNumber(number)) => {
                    track_number = u32::try_from(*number).ok();
                }
                Some(StandardTag::TrackTotal(total)) => {
                    track_total = u32::try_from(*total).ok();
                }
                _ => {}
            }
        }
    }
    track_number = track_number.or_else(|| infer_track_number(path));

    let mut issues = Vec::new();
    if duration_seconds.is_none() {
        issues.push("No reliable duration was reported.".to_owned());
    }
    if track_number.is_none() {
        issues.push("No track number was found in the tags or filename.".to_owned());
    }
    if !extension_matches_codec(extension, codec_name) {
        issues.push(format!(
            "The .{extension} extension does not match the detected {codec} stream."
        ));
    }
    if registration.is_none() {
        issues.push(format!(
            "{codec} headers are readable, but full frame decoding is not available in this Soundcheck version."
        ));
    }

    let mut sonic = None;
    if deep {
        if registration.is_none() {
            return Ok(SoundcheckResult {
                status: SoundcheckStatus::Unsupported,
                checked_at_ms,
                deep,
                codec: Some(codec),
                container: Some(extension.to_ascii_uppercase()),
                duration_seconds,
                bitrate_kbps: None,
                sample_rate: params.sample_rate,
                bits_per_sample: params.bits_per_coded_sample.or(params.bits_per_sample),
                channels: params.channels.map(|channels| channels.count() as u32),
                track_number,
                track_total,
                issues,
                sonic: None,
                source_stamp: source_stamp(path),
            });
        }
        let mut decoder = codecs()
            .make_audio_decoder(&params, &AudioDecoderOptions::default().verify(true))
            .map_err(|error| {
                format!("The {codec} stream could not be opened for decoding: {error}")
            })?;
        let mut packets = 0_u64;
        let lossless = is_lossless_codec(params.codec);
        let mut analyzer = None;
        let mut analysis_unavailable = false;
        loop {
            let packet = match format.next_packet() {
                Ok(Some(packet)) => packet,
                Ok(None) => break,
                Err(SymphoniaError::ResetRequired) => {
                    return Err("The audio stream changed format during the deep scan.".to_owned())
                }
                Err(error) => return Err(format!("The audio stream ended unexpectedly: {error}")),
            };
            if packet.track_id != track.id {
                continue;
            }
            let decoded = decoder
                .decode(&packet)
                .map_err(|error| format!("A damaged audio frame was found: {error}"))?;
            if !analysis_unavailable && analyzer.is_none() {
                match Analyzer::new(
                    decoded.spec().rate(),
                    decoded.num_planes(),
                    params.bits_per_sample.or(params.bits_per_coded_sample),
                    lossless,
                ) {
                    Ok(value) => analyzer = Some(value),
                    Err(message) => {
                        issues.push(message);
                        analysis_unavailable = true;
                    }
                }
            }
            if let Some(analyzer) = &mut analyzer {
                analyzer.push(&decoded)?;
            }
            packets = packets.saturating_add(1);
        }
        if packets == 0 {
            return Err("The deep scan found no decodable audio frames.".to_owned());
        }
        if decoder.finalize().verify_ok == Some(false) {
            return Err("The decoder's embedded integrity check did not match.".to_owned());
        }
        sonic = analyzer.map(Analyzer::finish);
        if let Some(evidence) = &sonic {
            issues.extend(evidence.issues());
        }
    }

    let bitrate_kbps = duration_seconds.and_then(|duration| {
        std::fs::metadata(path).ok().and_then(|metadata| {
            (duration > 0.0)
                .then(|| ((metadata.len() as f64 * 8.0) / duration / 1_000.0).round() as u32)
        })
    });
    Ok(SoundcheckResult {
        status: if issues.is_empty() {
            SoundcheckStatus::Passed
        } else {
            SoundcheckStatus::Review
        },
        checked_at_ms,
        deep,
        codec: Some(codec),
        container: Some(extension.to_ascii_uppercase()),
        duration_seconds,
        bitrate_kbps,
        sample_rate: params.sample_rate,
        bits_per_sample: params.bits_per_coded_sample.or(params.bits_per_sample),
        channels: params.channels.map(|channels| channels.count() as u32),
        track_number,
        track_total,
        issues,
        sonic,
        source_stamp: source_stamp(path),
    })
}

fn codecs() -> &'static CodecRegistry {
    static CODECS: OnceLock<CodecRegistry> = OnceLock::new();
    CODECS.get_or_init(|| {
        let mut codecs = CodecRegistry::new();
        default::register_enabled_codecs(&mut codecs);
        codecs
    })
}

fn is_lossless_codec(codec: AudioCodecId) -> bool {
    matches!(codec, CODEC_ID_FLAC | CODEC_ID_ALAC)
        || (CODEC_ID_PCM_S32LE..=CODEC_ID_PCM_F64BE_PLANAR).contains(&codec)
}

fn codec_fallback_name(codec: AudioCodecId, extension: &str) -> &'static str {
    match codec {
        CODEC_ID_MP3 => "mp3",
        CODEC_ID_AAC => "aac",
        CODEC_ID_ALAC => "alac",
        CODEC_ID_FLAC => "flac",
        CODEC_ID_VORBIS => "vorbis",
        CODEC_ID_OPUS => "opus",
        _ if matches!(extension, "wav" | "aif" | "aiff" | "caf") => "pcm",
        _ => "unknown audio",
    }
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
}

fn extension_matches_codec(extension: &str, codec: &str) -> bool {
    match codec.to_ascii_lowercase().as_str() {
        "mp1" => extension == "mp1",
        "mp2" => extension == "mp2",
        "mp3" | "mpeg audio" | "mpa" => extension == "mp3",
        "aac" => matches!(extension, "aac" | "m4a" | "mp4"),
        "alac" => matches!(extension, "alac" | "m4a" | "mp4"),
        "flac" => extension == "flac",
        "vorbis" => matches!(extension, "ogg" | "oga"),
        "opus" => matches!(extension, "ogg" | "oga" | "opus"),
        codec if codec.contains("pcm") => matches!(extension, "wav" | "aif" | "aiff" | "caf"),
        _ => true,
    }
}

fn infer_track_number(path: &Path) -> Option<u32> {
    let stem = path.file_stem()?.to_str()?.trim_start();
    let digits = stem
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    let remainder = &stem[digits.len()..];
    if remainder.is_empty() || remainder.starts_with([' ', '-', '.', '_']) || digits.len() >= 2 {
        digits.parse::<u32>().ok().filter(|number| *number > 0)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};
    use tempfile::tempdir;

    #[test]
    fn soundcheck_does_not_mistake_companded_or_adpcm_wav_for_lossless() {
        use symphonia::core::codecs::audio::well_known::*;
        assert!(is_lossless_codec(CODEC_ID_PCM_S24LE));
        assert!(is_lossless_codec(CODEC_ID_ALAC));
        for codec in [
            CODEC_ID_MP3,
            CODEC_ID_ADPCM_MS,
            CODEC_ID_PCM_ALAW,
            CODEC_ID_PCM_MULAW,
        ] {
            assert!(!is_lossless_codec(codec));
        }
    }

    fn write_wav(path: &Path) {
        let sample_count = 8_000_u32;
        let data_size = sample_count * 2;
        let mut file = File::create(path).unwrap();
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(36 + data_size).to_le_bytes()).unwrap();
        file.write_all(b"WAVEfmt ").unwrap();
        file.write_all(&16_u32.to_le_bytes()).unwrap();
        file.write_all(&1_u16.to_le_bytes()).unwrap();
        file.write_all(&1_u16.to_le_bytes()).unwrap();
        file.write_all(&8_000_u32.to_le_bytes()).unwrap();
        file.write_all(&16_000_u32.to_le_bytes()).unwrap();
        file.write_all(&2_u16.to_le_bytes()).unwrap();
        file.write_all(&16_u16.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&data_size.to_le_bytes()).unwrap();
        file.write_all(&vec![0_u8; data_size as usize]).unwrap();
    }

    #[test]
    fn quick_and_deep_scans_read_a_complete_wav() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("01 - Soundcheck.wav");
        write_wav(&path);

        let quick = inspect_file(&path, false, 42).unwrap();
        assert_eq!(quick.status, SoundcheckStatus::Passed);
        assert_eq!(quick.track_number, Some(1));
        assert_eq!(quick.sample_rate, Some(8_000));
        assert!(!quick.deep);

        let deep = inspect_file(&path, true, 43).unwrap();
        assert_eq!(deep.status, SoundcheckStatus::Passed);
        assert!(deep.deep);
        assert!(quick.sonic.is_none());
        assert_eq!(
            deep.sonic.unwrap().verdict,
            sonic::SonicVerdict::Inconclusive
        );
    }

    #[test]
    fn sonic_decodes_integer_padding_and_clipping_without_changing_file() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("01 - padded.wav");
        let rate = 48_000_u32;
        let samples = rate * 4;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + samples * 3).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 3).to_le_bytes());
        bytes.extend_from_slice(&3_u16.to_le_bytes());
        bytes.extend_from_slice(&24_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(samples * 3).to_le_bytes());
        for n in 0..samples {
            let sample = if n < 4 {
                -8388608_i32
            } else {
                ((n % 32000) as i32 - 16000) * 256
            };
            bytes.extend_from_slice(&sample.to_le_bytes()[..3]);
        }
        fs::write(&path, &bytes).unwrap();
        let result = inspect_file(&path, true, 42).unwrap();
        assert_eq!(result.status, SoundcheckStatus::Review);
        let evidence = result.sonic.unwrap();
        assert!(evidence.padded_bit_depth);
        assert_eq!(evidence.clipping_runs, 1);
        assert_eq!(evidence.clipped_samples, 4);
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn sonic_encoded_flac_fixtures() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("test-fixtures/soundcheck");
        for (name, expected) in [
            ("01-broadband.flac", sonic::SonicVerdict::LikelyGenuine),
            (
                "02-transcoded-128.flac",
                sonic::SonicVerdict::SuspectTranscode,
            ),
            (
                "03-transcoded-320.flac",
                sonic::SonicVerdict::SuspectTranscode,
            ),
            ("04-upsampled.flac", sonic::SonicVerdict::LikelyUpsampled),
        ] {
            let path = root.join(name);
            let before = fs::read(&path).unwrap();
            let result = inspect_file(&path, true, 42).unwrap();
            let evidence = result.sonic.as_ref().expect("decoded signal evidence");
            assert_eq!(
                evidence.verdict, expected,
                "{name}: cutoff {:?}, status {:?}, issues {:?}",
                evidence.cutoff_hz, result.status, result.issues
            );
            assert_eq!(fs::read(&path).unwrap(), before);
            if let Ok(output) = std::env::var("FOREVER_SONIC_EVIDENCE_DIR") {
                fs::create_dir_all(&output).unwrap();
                fs::write(
                    Path::new(&output).join(format!("{name}.json")),
                    serde_json::to_vec_pretty(&result).unwrap(),
                )
                .unwrap();
            }
        }
    }

    #[test]
    fn corrupt_audio_is_reported_without_modifying_it() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("02 - Broken.flac");
        fs::write(&path, b"not an audio stream").unwrap();
        let before = fs::read(&path).unwrap();

        let result = inspect_file(&path, false, 42).unwrap();

        assert_eq!(result.status, SoundcheckStatus::Failed);
        assert!(!result.issues.is_empty());
        assert_eq!(fs::read(path).unwrap(), before);
    }

    #[test]
    fn unsupported_audio_stays_visible_for_review() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("03 - Legacy.wma");
        fs::write(&path, b"legacy").unwrap();

        let result = inspect_file(&path, false, 42).unwrap();

        assert_eq!(result.status, SoundcheckStatus::Unsupported);
        assert_eq!(result.track_number, None);
    }
}
