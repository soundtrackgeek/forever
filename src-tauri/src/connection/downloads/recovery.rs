use super::*;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReliability {
    pub successes: u32,
    pub failures: u32,
    pub denials: u32,
    pub starts: u32,
    pub typical_start_delay_ms: u64,
    pub typical_speed: u64,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub sonic_observations: Vec<SonicObservation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SonicObservation {
    pub key: String,
    pub concern: bool,
}

pub(super) fn observe_sonic(
    memory: &mut HashMap<String, SourceReliability>,
    transfer: &TransferSnapshot,
) {
    let Some(evidence) = transfer.soundcheck.as_ref().and_then(|r| r.sonic.as_ref()) else {
        return;
    };
    // Same remote file/size counts once across rescans and repeated downloads.
    // Keep only a bounded local history, separate from transfer success/failure.
    let key = format!(
        "{:x}",
        md5::compute(format!(
            "{}\0{}",
            transfer.remote_filename, transfer.size_bytes
        ))
    );
    observe(memory, &transfer.username, |r| {
        r.sonic_observations.retain(|item| item.key != key);
        r.sonic_observations.push(SonicObservation {
            key,
            concern: evidence.needs_review(),
        });
        if r.sonic_observations.len() > 128 {
            r.sonic_observations
                .drain(..r.sonic_observations.len() - 128);
        }
    });
}

pub(super) fn observe(
    memory: &mut HashMap<String, SourceReliability>,
    username: &str,
    update: impl FnOnce(&mut SourceReliability),
) {
    let key = username.to_ascii_lowercase();
    if !memory.contains_key(&key) && memory.len() >= 1_000 {
        if let Some(oldest) = memory
            .iter()
            .min_by_key(|(_, r)| r.updated_at_ms)
            .map(|(k, _)| k.clone())
        {
            memory.remove(&oldest);
        }
    }
    let entry = memory.entry(key).or_default();
    update(entry);
    entry.updated_at_ms = timestamp_ms();
}

pub(super) fn smooth(previous: u64, sample: u64) -> u64 {
    // Integer EMA, alpha = 0.2; u128 prevents overflow on untrusted sizes/rates.
    ((u128::from(previous) * 4 + u128::from(sample)) / 5) as u64
}

// This check runs under the same write lock as the switch. A late folder reply
// cannot override a pause, a new source, a started download, or Safe Passage.
pub(super) fn exact_recovery_indices(
    transfers: &[TransferSnapshot],
    release_id: &str,
    source: &ReleaseAlternativeSource,
    minutes: u32,
    now: u64,
) -> Option<Vec<(usize, usize)>> {
    if minutes == 0 {
        return None;
    }
    let release: Vec<_> = transfers
        .iter()
        .enumerate()
        .filter(|(_, t)| t.release_id.as_deref() == Some(release_id))
        .collect();
    if release.is_empty()
        || release.iter().any(|(_, t)| {
            matches!(
                t.status,
                TransferStatus::Downloading | TransferStatus::Paused
            ) || t.username.eq_ignore_ascii_case(&source.username)
                || t.automatic_sources.len() >= 4
                || t.automatic_sources
                    .iter()
                    .any(|u| u.eq_ignore_ascii_case(&source.username))
        })
    {
        return None;
    }
    if !release.iter().any(|(_, t)| {
        t.status != TransferStatus::Completed
            && t.waiting_since_ms
                .is_some_and(|at| now.saturating_sub(at) >= u64::from(minutes) * 60_000)
    }) {
        return None;
    }
    let mut used = HashSet::new();
    let mut result = Vec::new();
    for (index, transfer) in release {
        if transfer.status == TransferStatus::Completed {
            continue;
        }
        // Local/disk failures and explicit pauses never trigger source recovery.
        if transfer.status == TransferStatus::Failed && transfer.waiting_since_ms.is_none() {
            return None;
        }
        let candidates: Vec<_> = source
            .files
            .iter()
            .enumerate()
            .filter(|(_, file)| {
                file.size_bytes == transfer.size_bytes
                    && remote_basename(&file.remote_filename)
                        .eq_ignore_ascii_case(remote_basename(&transfer.remote_filename))
            })
            .collect();
        if candidates.len() != 1 || !used.insert(candidates[0].0) {
            return None;
        }
        result.push((index, candidates[0].0));
    }
    (!result.is_empty()).then_some(result)
}

fn remote_basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

pub(super) fn file_attempt(transfer: &TransferSnapshot, id: &str, token: u32) -> bool {
    transfer.id == id
        && transfer.transfer_token == Some(token)
        && transfer.status == TransferStatus::Downloading
}

pub(super) fn apply_exact_recovery(
    transfers: &mut [TransferSnapshot],
    indices: &[(usize, usize)],
    source: &ReleaseAlternativeSource,
    now: u64,
) {
    for &(index, file_index) in indices {
        let transfer = &mut transfers[index];
        if transfer.automatic_sources.is_empty() {
            transfer.automatic_sources.push(transfer.username.clone());
        }
        transfer.automatic_sources.push(source.username.clone());
        transfer.username = source.username.clone();
        transfer.remote_filename =
            normalize_remote_filename(&source.files[file_index].remote_filename);
        transfer.status = TransferStatus::Queued;
        reset_runtime_state(transfer);
        transfer.retry_count = 0;
        transfer.retry_at_ms = None;
        transfer.error = None;
        transfer.updated_at_ms = now;
        transfer.last_automatic_switch_at_ms = Some(now);
        // Keep title, destination, size, completed files and the .part bytes.
        // begin_file derives the resume offset from the real file length.
    }
}
