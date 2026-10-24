//! Local, advisory signal evidence. A spectral shelf is not proof of provenance.
//! Fixed FFT buffers, four windows/second, and a coalescing 96x64 spectrogram
//! keep memory independent of track length. Channels are never summed in phase.
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use symphonia::core::audio::GenericAudioBufferRef;

const FFT_SIZE: usize = 4096;
const BANDS: usize = 64;
const COLUMNS: usize = 96;
const SHELVES: [u32; 22] = [
    14_000, 14_500, 15_000, 15_500, 16_000, 16_500, 17_000, 17_500, 18_000, 18_500, 19_000, 19_500,
    20_000, 20_500, 21_000, 21_500, 22_000, 22_050, 22_500, 23_000, 23_500, 24_000,
];

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SonicVerdict {
    LikelyGenuine,
    SuspectTranscode,
    LikelyUpsampled,
    Inconclusive,
    LossySource,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SonicEvidence {
    pub version: u32,
    pub verdict: SonicVerdict,
    pub analyzed_seconds: f64,
    pub sample_rate: u32,
    pub windows: u64,
    pub active_windows: u64,
    pub cutoff_hz: Option<u32>,
    pub cutoff_consistency: f64,
    pub energy_above_cutoff_db: Option<f64>,
    pub padded_bit_depth: bool,
    pub clipped_samples: u64,
    pub clipping_runs: u64,
    /// Time columns, low-to-high frequency bins, relative power: 0=-96dB, 96=0dB.
    #[serde(with = "compact_spectrogram")]
    pub spectrogram: Vec<Vec<u8>>,
    pub column_seconds: f64,
}

mod compact_spectrogram {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(columns: &[Vec<u8>], serializer: S) -> Result<S::Ok, S::Error> {
        serializer
            .serialize_str(&STANDARD.encode(columns.iter().flatten().copied().collect::<Vec<_>>()))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<Vec<u8>>, D::Error> {
        let text = String::deserialize(deserializer)?;
        if text.len() > 8192 {
            return Err(serde::de::Error::custom(
                "Spectrogram exceeds its size limit",
            ));
        }
        let bytes = STANDARD.decode(text).map_err(serde::de::Error::custom)?;
        if bytes.len() % super::BANDS != 0 || bytes.iter().any(|b| *b > 96) {
            return Err(serde::de::Error::custom("Invalid spectrogram cells"));
        }
        Ok(bytes.chunks(super::BANDS).map(<[u8]>::to_vec).collect())
    }
}

impl SonicEvidence {
    pub fn needs_review(&self) -> bool {
        matches!(
            self.verdict,
            SonicVerdict::SuspectTranscode | SonicVerdict::LikelyUpsampled
        ) || self.padded_bit_depth
            || self.clipping_runs > 0
    }

    pub fn issues(&self) -> Vec<String> {
        let mut issues = Vec::new();
        match self.verdict {
            SonicVerdict::SuspectTranscode => issues.push(format!(
                "Suspect transcode: consistent {:.1} kHz shelf; a limited original master can look similar. Codec/bitrate cannot be proven.",
                self.cutoff_hz.unwrap_or_default() as f64 / 1000.0)),
            SonicVerdict::LikelyUpsampled => issues.push(format!(
                "Likely upsampled: consistent {:.1} kHz shelf below this stream's bandwidth; original mastering may explain it.",
                self.cutoff_hz.unwrap_or_default() as f64 / 1000.0)),
            _ => {}
        }
        if self.padded_bit_depth {
            issues.push("Padded bit depth: all decoded samples fit a 16-bit grid in a higher-depth integer stream.".into());
        }
        if self.clipping_runs > 0 {
            issues.push(format!("Possible clipping: {} runs of at least three full-scale samples ({} full-scale samples total).", self.clipping_runs, self.clipped_samples));
        }
        issues
    }
}

pub struct Analyzer {
    rate: u32,
    channels: usize,
    bits: Option<u32>,
    lossless: bool,
    integer: bool,
    fft: Arc<dyn Fft<f64>>,
    scratch: Vec<Complex<f64>>,
    buffers: Vec<Vec<Complex<f64>>>,
    window: Vec<f64>,
    frames: u64,
    windows: u64,
    active: u64,
    full_band: u64,
    votes: [u64; SHELVES.len()],
    above_db: [f64; SHELVES.len()],
    padded: bool,
    nonzero: u64,
    clipped: u64,
    runs: u64,
    channel_runs: Vec<u64>,
    columns: Vec<Vec<u8>>,
    column_stride: u64,
    pending_column: Vec<u8>,
    pending_count: u64,
    converted: Vec<f64>,
}

impl Analyzer {
    pub fn new(
        rate: u32,
        channels: usize,
        bits: Option<u32>,
        lossless: bool,
    ) -> Result<Self, String> {
        if !(8_000..=384_000).contains(&rate) || !(1..=8).contains(&channels) {
            return Err(
                "Sonic analysis supports 8–384 kHz streams with one to eight channels.".into(),
            );
        }
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        let scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        Ok(Self {
            rate,
            channels,
            bits,
            lossless,
            integer: true,
            fft,
            scratch,
            buffers: vec![vec![Complex::default(); FFT_SIZE]; channels],
            window: (0..FFT_SIZE)
                .map(|n| 0.5 - 0.5 * (std::f64::consts::TAU * n as f64 / FFT_SIZE as f64).cos())
                .collect(),
            frames: 0,
            windows: 0,
            active: 0,
            full_band: 0,
            votes: [0; SHELVES.len()],
            above_db: [0.0; SHELVES.len()],
            padded: true,
            nonzero: 0,
            clipped: 0,
            runs: 0,
            channel_runs: vec![0; channels],
            columns: Vec::new(),
            column_stride: 1,
            pending_column: vec![0; BANDS],
            pending_count: 0,
            converted: Vec::new(),
        })
    }

    pub fn push(&mut self, audio: &GenericAudioBufferRef<'_>) -> Result<(), String> {
        if audio.spec().rate() != self.rate || audio.num_planes() != self.channels {
            return Err("The audio format changed during sonic analysis.".into());
        }
        // Refuse an unexpectedly large decoder packet before allocating a conversion buffer.
        if audio.frames().saturating_mul(self.channels) > 2_097_152 {
            return Err("The decoder returned an oversized audio packet.".into());
        }
        self.integer &= !matches!(
            audio,
            GenericAudioBufferRef::F32(_) | GenericAudioBufferRef::F64(_)
        );
        let mut samples = std::mem::take(&mut self.converted);
        audio.copy_to_vec_interleaved(&mut samples);
        self.push_samples(&samples)?;
        self.converted = samples;
        Ok(())
    }

    fn push_samples(&mut self, samples: &[f64]) -> Result<(), String> {
        let hop = (self.rate as usize / 4).max(FFT_SIZE);
        let rail = 1.0 - 2_f64.powi(1 - self.bits.unwrap_or(32).clamp(8, 32) as i32);
        for frame in samples.chunks_exact(self.channels) {
            let offset = self.frames as usize % hop;
            for (channel, &sample) in frame.iter().enumerate() {
                if !sample.is_finite() {
                    return Err("Non-finite decoded audio samples were found.".into());
                }
                if sample != 0.0 {
                    self.nonzero += 1;
                }
                self.padded &= (sample * 32768.0).fract() == 0.0;
                if sample >= rail || sample <= -1.0 {
                    self.clipped += 1;
                    self.channel_runs[channel] += 1;
                    if self.channel_runs[channel] == 3 {
                        self.runs += 1;
                    }
                } else {
                    self.channel_runs[channel] = 0;
                }
                if offset < FFT_SIZE {
                    self.buffers[channel][offset] = Complex::new(sample * self.window[offset], 0.0);
                }
            }
            self.frames += 1;
            if offset == FFT_SIZE - 1 {
                self.analyze_window();
            }
        }
        Ok(())
    }

    fn analyze_window(&mut self) {
        let mut power = vec![0.0; FFT_SIZE / 2];
        for buffer in &mut self.buffers {
            self.fft.process_with_scratch(buffer, &mut self.scratch);
            for (out, value) in power.iter_mut().zip(buffer.iter()) {
                *out += value.norm_sqr() / self.channels as f64;
            }
        }
        power[0] = 0.0;
        self.windows += 1;
        let total: f64 = power.iter().sum();
        let peak = power.iter().copied().fold(0.0_f64, f64::max);
        let bin = |hz: u32| (hz as usize * FFT_SIZE / self.rate as usize).min(power.len());
        let band = |low, high| {
            let lo = bin(low);
            let hi = bin(high);
            if hi > lo {
                power[lo..hi].iter().sum::<f64>() / (hi - lo) as f64
            } else {
                0.0
            }
        };
        // Silence/near-silence and tonal content cannot establish a spectral shelf.
        if total / (FFT_SIZE * FFT_SIZE) as f64 > 1e-9 {
            self.active += 1;
            let occupied = power.iter().filter(|&&p| p > peak * 1e-5).count();
            if occupied > power.len() / 2
                && power[power.len() * 4 / 5..].iter().sum::<f64>() / total > 1e-4
            {
                self.full_band += 1;
            }
            for (index, &cutoff) in SHELVES.iter().enumerate() {
                if cutoff + 1500 >= self.rate / 2 {
                    continue;
                }
                let before = band(cutoff - 750, cutoff - 250);
                let after = band(cutoff + 300, cutoff + 1500);
                let above = power[bin(cutoff + 300)..].iter().sum::<f64>() / total;
                // Resamplers can have a gradual transition and an image just
                // above the original Nyquist. Require a deep stopband beyond
                // that transition, near a standard 44.1/48 kHz source rate.
                let resampled = self.rate > 48_000
                    && matches!(cutoff, 22_050 | 24_000)
                    && power[bin(cutoff + 3000)..].iter().sum::<f64>() / total < 1e-5;
                if occupied > bin(cutoff) / 2
                    && before > peak * 1e-4
                    && ((after / before < 0.001 && above < 0.0001) || resampled)
                {
                    self.votes[index] += 1;
                    self.above_db[index] += 10.0 * above.max(1e-12).log10();
                }
            }
        }
        let column: Vec<u8> = power
            .chunks(FFT_SIZE / 2 / BANDS)
            .map(|values| {
                let value = values.iter().copied().fold(0.0_f64, f64::max);
                if peak <= 1e-12 {
                    0
                } else {
                    (96.0 + 10.0 * (value / peak).max(1e-12).log10())
                        .clamp(0.0, 96.0)
                        .round() as u8
                }
            })
            .collect();
        for (out, value) in self.pending_column.iter_mut().zip(column) {
            *out = (*out).max(value);
        }
        self.pending_count += 1;
        if self.pending_count == self.column_stride {
            self.columns
                .push(std::mem::replace(&mut self.pending_column, vec![0; BANDS]));
            self.pending_count = 0;
            if self.columns.len() == COLUMNS {
                self.columns = self
                    .columns
                    .chunks(2)
                    .map(|pair| {
                        pair[0]
                            .iter()
                            .zip(&pair[1])
                            .map(|(a, b)| *a.max(b))
                            .collect()
                    })
                    .collect();
                self.column_stride *= 2;
            }
        }
    }

    pub fn finish(mut self) -> SonicEvidence {
        if self.pending_count > 0 {
            self.columns.push(self.pending_column);
        }
        let seconds = self.frames as f64 / self.rate as f64;
        let (index, votes) = self
            .votes
            .iter()
            .copied()
            .enumerate()
            .max_by_key(|(i, n)| (*n, std::cmp::Reverse(*i)))
            .unwrap();
        let consistency = votes as f64 / self.active.max(1) as f64;
        let sufficient = seconds >= 3.0 && self.active >= 12;
        let cutoff = (sufficient && consistency >= 0.85).then_some(SHELVES[index]);
        let verdict = if !self.lossless {
            SonicVerdict::LossySource
        } else if cutoff.is_some() && self.rate > 48_000 {
            SonicVerdict::LikelyUpsampled
        } else if cutoff.is_some() {
            SonicVerdict::SuspectTranscode
        } else if sufficient && self.full_band as f64 / self.active as f64 >= 0.8 {
            SonicVerdict::LikelyGenuine
        } else {
            SonicVerdict::Inconclusive
        };
        SonicEvidence {
            version: 1,
            verdict,
            analyzed_seconds: seconds,
            sample_rate: self.rate,
            windows: self.windows,
            active_windows: self.active,
            cutoff_hz: cutoff,
            cutoff_consistency: if cutoff.is_some() { consistency } else { 0.0 },
            energy_above_cutoff_db: cutoff.map(|_| self.above_db[index] / votes as f64),
            padded_bit_depth: self.lossless
                && self.integer
                && self.bits.is_some_and(|bits| bits > 16)
                && self.padded
                && seconds >= 3.0
                && self.nonzero >= 10_000,
            clipped_samples: self.clipped,
            clipping_runs: self.runs,
            spectrogram: self.columns,
            column_seconds: self.column_stride as f64
                * (self.rate as usize / 4).max(FFT_SIZE) as f64
                / self.rate as f64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noise(rate: u32, cutoff: u32) -> Vec<f64> {
        let mut spectrum = vec![Complex::default(); FFT_SIZE];
        let mut seed = 17_u32;
        for n in 1..(cutoff as usize * FFT_SIZE / rate as usize).min(FFT_SIZE / 2) {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let phase = seed as f64 / u32::MAX as f64 * std::f64::consts::TAU;
            spectrum[n] = Complex::from_polar(1.0, phase);
            spectrum[FFT_SIZE - n] = spectrum[n].conj();
        }
        FftPlanner::new()
            .plan_fft_inverse(FFT_SIZE)
            .process(&mut spectrum);
        spectrum
            .iter()
            .map(|v| v.re / FFT_SIZE as f64 * 8.0)
            .collect()
    }

    fn analyze(rate: u32, cutoff: u32, lossless: bool) -> SonicEvidence {
        let signal = noise(rate, cutoff);
        let mut analyzer = Analyzer::new(rate, 2, Some(24), lossless).unwrap();
        // Opposite phase channels must not cancel spectral evidence.
        let stereo: Vec<_> = signal.iter().flat_map(|&v| [v, -v]).collect();
        for _ in 0..(rate as usize * 5 / FFT_SIZE + 1) {
            analyzer.push_samples(&stereo).unwrap();
        }
        analyzer.finish()
    }

    #[test]
    fn sonic_shelves_broadband_and_lossy_sources() {
        for cutoff in [16_000, 19_000, 20_000] {
            let evidence = analyze(48_000, cutoff, true);
            assert_eq!(
                evidence.verdict,
                SonicVerdict::SuspectTranscode,
                "{evidence:?}"
            );
            assert_eq!(evidence.cutoff_hz, Some(cutoff));
            assert!(evidence.energy_above_cutoff_db.unwrap() < -40.0);
        }
        assert_eq!(
            analyze(96_000, 24_000, true).verdict,
            SonicVerdict::LikelyUpsampled
        );
        assert_eq!(
            analyze(48_000, 24_000, true).verdict,
            SonicVerdict::LikelyGenuine
        );
        assert_eq!(
            analyze(48_000, 16_000, false).verdict,
            SonicVerdict::LossySource
        );
    }

    #[test]
    fn sonic_abstains_on_silence_tones_short_and_changing_spectra() {
        for signal in [
            vec![0.0; 48_000 * 4],
            (0..48_000 * 4)
                .map(|n| (n as f64 * 0.3).sin() * 0.5)
                .collect(),
        ] {
            let mut analyzer = Analyzer::new(48_000, 1, Some(24), true).unwrap();
            analyzer.push_samples(&signal).unwrap();
            let evidence = analyzer.finish();
            assert_eq!(evidence.verdict, SonicVerdict::Inconclusive);
            assert!(!evidence.padded_bit_depth);
        }
        let mut analyzer = Analyzer::new(48_000, 1, Some(24), true).unwrap();
        analyzer.push_samples(&noise(48_000, 16_000)).unwrap();
        assert_eq!(analyzer.finish().verdict, SonicVerdict::Inconclusive);
        let mut analyzer = Analyzer::new(48_000, 1, Some(24), true).unwrap();
        for cutoff in [16_000, 24_000] {
            for _ in 0..30 {
                analyzer.push_samples(&noise(48_000, cutoff)).unwrap();
            }
        }
        assert_eq!(analyzer.finish().verdict, SonicVerdict::Inconclusive);
    }

    #[test]
    fn sonic_padding_clipping_and_nonfinite_samples() {
        let mut analyzer = Analyzer::new(48_000, 1, Some(24), true).unwrap();
        let signal: Vec<_> = (0..48_000 * 4)
            .map(|n| ((n * 31 % 32000) as f64 - 16000.0) / 32768.0)
            .collect();
        analyzer.push_samples(&signal).unwrap();
        analyzer
            .push_samples(&[-1.0, -1.0, -1.0, -1.0, 0.0, -1.0])
            .unwrap();
        let evidence = analyzer.finish();
        assert!(evidence.padded_bit_depth);
        assert_eq!(evidence.clipping_runs, 1);
        assert_eq!(evidence.clipped_samples, 5);
        let mut analyzer = Analyzer::new(48_000, 1, Some(24), true).unwrap();
        analyzer.push_samples(&signal).unwrap();
        analyzer.push_samples(&[1.0 / 8388608.0]).unwrap();
        assert!(!analyzer.finish().padded_bit_depth);
        let mut analyzer = Analyzer::new(48_000, 1, Some(32), true).unwrap();
        assert!(analyzer.push_samples(&[f64::NAN]).is_err());
    }

    #[test]
    fn sonic_spectrogram_storage_is_bounded_and_spans_the_track() {
        let mut analyzer = Analyzer::new(8_000, 1, Some(16), true).unwrap();
        for _ in 0..500 {
            analyzer.push_samples(&[0.0; FFT_SIZE]).unwrap();
        }
        let evidence = analyzer.finish();
        assert!(evidence.spectrogram.len() <= COLUMNS);
        assert!(evidence
            .spectrogram
            .iter()
            .all(|column| column.len() == BANDS));
        assert!(
            evidence.column_seconds * evidence.spectrogram.len() as f64
                >= evidence.analyzed_seconds
        );
        assert!(serde_json::to_vec(&evidence).unwrap().len() < 26_000);
    }
}
