use super::uploads::{UploadSnapshot, UploadStatus};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadPolicy {
    pub max_files_per_user: u32,
    pub max_megabytes_per_user: u32,
    pub prioritize_favorites: bool,
    pub prioritize_privileged: bool,
}

impl Default for UploadPolicy {
    fn default() -> Self {
        Self {
            max_files_per_user: 100,
            max_megabytes_per_user: 10_000,
            prioritize_favorites: false,
            prioritize_privileged: false,
        }
    }
}

impl UploadPolicy {
    pub fn valid(&self) -> bool {
        (1..=500).contains(&self.max_files_per_user)
            && (1..=1_000_000).contains(&self.max_megabytes_per_user)
    }
}

#[derive(Clone, Default)]
pub struct FairScheduler {
    pub served: HashSet<String>,
    pub policy: UploadPolicy,
    pub favorites: Arc<HashSet<String>>,
    pub privileged: Arc<HashSet<String>>,
}

impl FairScheduler {
    // Least active users get the next slot. Within that group, serve each user
    // once per round; optional priorities only order the unserved users. FIFO
    // within each user's requests is preserved by the final index tie-break.
    pub fn take_next(&mut self, uploads: &[UploadSnapshot]) -> Option<usize> {
        let mut active: HashMap<String, usize> = HashMap::new();
        for upload in uploads.iter().filter(|u| u.status.occupies_slot()) {
            *active
                .entry(upload.username.to_ascii_lowercase())
                .or_default() += 1;
        }
        let waiting: Vec<_> = uploads
            .iter()
            .enumerate()
            .filter(|(_, u)| u.status == UploadStatus::Queued)
            .map(|(i, u)| (i, u.username.to_ascii_lowercase()))
            .collect();
        let minimum = waiting
            .iter()
            .map(|(_, user)| active.get(user).copied().unwrap_or(0))
            .min()?;
        let candidates: Vec<_> = waiting
            .iter()
            .filter(|(_, user)| active.get(user).copied().unwrap_or(0) == minimum)
            .collect();
        if candidates
            .iter()
            .all(|(_, user)| self.served.contains(user))
        {
            self.served.clear();
        }
        let (index, user) = candidates.into_iter().min_by_key(|(i, user)| {
            (
                self.served.contains(user),
                !(self.policy.prioritize_favorites && self.favorites.contains(user)),
                !(self.policy.prioritize_privileged && self.privileged.contains(user)),
                *i,
            )
        })?;
        self.served.insert(user.clone());
        Some(*index)
    }

    pub fn refresh_positions(&self, uploads: &mut [UploadSnapshot]) {
        let mut simulation = uploads.to_vec();
        let mut scheduler = self.clone();
        for upload in uploads.iter_mut() {
            upload.queue_position = upload.status.occupies_slot().then_some(0);
        }
        let mut position = 1;
        while let Some(index) = scheduler.take_next(&simulation) {
            uploads[index].queue_position = Some(position);
            simulation[index].status = UploadStatus::Connecting;
            position += 1;
        }
    }
}
