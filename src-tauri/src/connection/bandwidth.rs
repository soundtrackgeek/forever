//! One payload budget shared by every transfer, independent of server sessions.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio::time::Instant;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub total_kib: u32,
    pub download_kib: u32,
    pub upload_kib: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BandwidthSettings {
    pub normal: Limits,
    pub alternate: Limits,
    pub schedule_enabled: bool,
    pub start_minute: u16,
    pub end_minute: u16,
    pub pause_on_metered: bool,
}
impl Default for BandwidthSettings {
    fn default() -> Self {
        Self {
            normal: Limits::default(),
            alternate: Limits::default(),
            schedule_enabled: false,
            start_minute: 23 * 60,
            end_minute: 7 * 60,
            pause_on_metered: false,
        }
    }
}
impl BandwidthSettings {
    pub fn validate(&self) -> Result<(), String> {
        if [self.normal, self.alternate].iter().any(|l| {
            [l.total_kib, l.download_kib, l.upload_kib]
                .iter()
                .any(|v| *v > 1_000_000)
        }) {
            return Err("Bandwidth limits must be whole numbers from 0 to 1,000,000 KiB/s.".into());
        }
        if self.start_minute >= 1440
            || self.end_minute >= 1440
            || (self.schedule_enabled && self.start_minute == self.end_minute)
        {
            return Err("Choose distinct schedule start and end times within one day.".into());
        }
        Ok(())
    }
    fn alternate_at(&self, minute: u16) -> bool {
        self.schedule_enabled
            && if self.start_minute < self.end_minute {
                minute >= self.start_minute && minute < self.end_minute
            } else {
                minute >= self.start_minute || minute < self.end_minute
            }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkCost {
    Unmetered,
    Metered,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub alternate_active: bool,
    pub limits: Limits,
    pub network_cost: NetworkCost,
    pub paused: bool,
}

#[derive(Clone, Copy)]
pub enum Direction {
    Download,
    Upload,
}
impl Direction {
    fn index(self) -> usize {
        match self {
            Self::Download => 1,
            Self::Upload => 2,
        }
    }
}

struct Bucket {
    rate: f64,
    tokens: f64,
    at: Instant,
}
impl Bucket {
    fn new(kib: u32, now: Instant) -> Self {
        Self {
            rate: f64::from(kib) * 1024.0,
            tokens: 0.0,
            at: now,
        }
    }
    fn capacity(&self) -> f64 {
        (self.rate / 4.0).clamp(1.0, 128.0 * 1024.0)
    }
    fn refill(&mut self, now: Instant) {
        self.tokens = (self.tokens + now.duration_since(self.at).as_secs_f64() * self.rate)
            .min(self.capacity());
        self.at = now;
    }
}
struct State {
    settings: BandwidthSettings,
    minute: u16,
    snapshot: Snapshot,
    buckets: [Bucket; 3],
    epoch: u64,
}
impl State {
    fn refresh(&mut self, now: Instant) -> bool {
        let alternate_active = self.settings.alternate_at(self.minute);
        let limits = if alternate_active {
            self.settings.alternate
        } else {
            self.settings.normal
        };
        let paused =
            self.settings.pause_on_metered && self.snapshot.network_cost != NetworkCost::Unmetered;
        let changed = self.snapshot.alternate_active != alternate_active
            || self.snapshot.limits != limits
            || self.snapshot.paused != paused;
        if self.snapshot.limits != limits || self.snapshot.paused != paused {
            self.buckets = [limits.total_kib, limits.download_kib, limits.upload_kib]
                .map(|r| Bucket::new(r, now));
            self.epoch += 1;
        }
        self.snapshot.alternate_active = alternate_active;
        self.snapshot.limits = limits;
        self.snapshot.paused = paused;
        changed
    }
}
struct Inner {
    state: Mutex<State>,
    changed: Notify,
    lanes: [AsyncMutex<()>; 2],
}
#[derive(Clone)]
pub struct Bandwidth(Arc<Inner>);
impl Bandwidth {
    pub fn new(settings: BandwidthSettings) -> Self {
        let now = Instant::now();
        let mut state = State {
            settings,
            minute: local_minute(),
            snapshot: Snapshot {
                revision: 0,
                alternate_active: false,
                limits: Limits::default(),
                network_cost: NetworkCost::Unknown,
                paused: false,
            },
            buckets: [0, 0, 0].map(|r| Bucket::new(r, now)),
            epoch: 0,
        };
        state.refresh(now);
        Self(Arc::new(Inner {
            state: Mutex::new(state),
            changed: Notify::new(),
            lanes: [AsyncMutex::new(()), AsyncMutex::new(())],
        }))
    }
    pub fn snapshot(&self) -> Snapshot {
        self.0
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .snapshot
            .clone()
    }
    pub fn configure(&self, settings: BandwidthSettings) {
        let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
        state.settings = settings;
        state.minute = local_minute();
        state.refresh(Instant::now());
        state.snapshot.revision += 1;
        drop(state);
        self.0.changed.notify_waiters();
    }
    pub fn environment(&self, minute: u16, cost: NetworkCost) -> bool {
        let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
        let cost_changed = state.snapshot.network_cost != cost;
        state.minute = minute;
        state.snapshot.network_cost = cost;
        let changed = state.refresh(Instant::now()) || cost_changed;
        if changed {
            state.snapshot.revision += 1;
        }
        drop(state);
        if changed {
            self.0.changed.notify_waiters();
        }
        changed
    }
    pub fn paused(&self) -> bool {
        self.snapshot().paused
    }

    // FIFO within each direction. No lock is held across network or disk I/O.
    // A cancelled/short read returns unused tokens through the permit's Drop.
    pub async fn acquire(
        &self,
        direction: Direction,
        maximum: usize,
        cancel: &AtomicBool,
    ) -> Option<Permit> {
        let lock = self.0.lanes[direction.index() - 1].lock();
        tokio::pin!(lock);
        let _lane = loop {
            if cancel.load(Ordering::SeqCst) {
                return None;
            }
            tokio::select! { guard = &mut lock => break guard,
            _ = tokio::time::sleep(Duration::from_millis(50)) => {} }
        };
        loop {
            if cancel.load(Ordering::SeqCst) {
                return None;
            }
            let notified = self.0.changed.notified();
            {
                let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
                if !state.snapshot.paused {
                    let now = Instant::now();
                    let mut count = maximum.min(128 * 1024);
                    for index in [0, direction.index()] {
                        let b = &mut state.buckets[index];
                        b.refill(now);
                        if b.rate > 0.0 {
                            count = count.min(b.tokens.floor() as usize);
                        }
                    }
                    if count > 0 {
                        for index in [0, direction.index()] {
                            if state.buckets[index].rate > 0.0 {
                                state.buckets[index].tokens -= count as f64;
                            }
                        }
                        return Some(Permit {
                            bandwidth: self.clone(),
                            direction,
                            count,
                            used: 0,
                            epoch: state.epoch,
                        });
                    }
                }
            }
            tokio::select! { _ = notified => {}, _ = tokio::time::sleep(Duration::from_millis(20)) => {} }
        }
    }
}
pub struct Permit {
    bandwidth: Bandwidth,
    direction: Direction,
    pub count: usize,
    used: usize,
    epoch: u64,
}
impl Permit {
    pub fn used(&mut self, count: usize) {
        self.used = count.min(self.count);
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        let mut state = self
            .bandwidth
            .0
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if state.epoch != self.epoch {
            return;
        }
        for index in [0, self.direction.index()] {
            let b = &mut state.buckets[index];
            if b.rate > 0.0 {
                b.tokens = (b.tokens + (self.count - self.used) as f64).min(b.capacity());
            }
        }
    }
}

pub fn local_minute() -> u16 {
    use chrono::Timelike;
    let now = chrono::Local::now();
    (now.hour() * 60 + now.minute()) as u16
}

#[cfg(windows)]
pub fn network_cost() -> NetworkCost {
    use windows::Networking::Connectivity::{NetworkCostType, NetworkInformation};
    let read = || -> windows::core::Result<NetworkCost> {
        let cost = NetworkInformation::GetInternetConnectionProfile()?.GetConnectionCost()?;
        let kind = cost.NetworkCostType()?;
        if cost.Roaming()?
            || cost.OverDataLimit()?
            || cost.BackgroundDataUsageRestricted()?
            || kind == NetworkCostType::Fixed
            || kind == NetworkCostType::Variable
        {
            Ok(NetworkCost::Metered)
        } else if kind == NetworkCostType::Unrestricted {
            Ok(NetworkCost::Unmetered)
        } else {
            Ok(NetworkCost::Unknown)
        }
    };
    read().unwrap_or(NetworkCost::Unknown)
}
#[cfg(not(windows))]
pub fn network_cost() -> NetworkCost {
    NetworkCost::Unknown
}

#[tauri::command]
pub fn bandwidth_snapshot(manager: tauri::State<'_, super::ConnectionManager>) -> Snapshot {
    manager.bandwidth().snapshot()
}

// Runs independently of the active workspace and Soulseek login. Windows reports
// the internet profile's cost; a VPN/per-route billing policy may differ.
pub fn start(app: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let controller = app.state::<super::ConnectionManager>().bandwidth();
    tauri::async_runtime::spawn(async move {
        loop {
            let cost = tauri::async_runtime::spawn_blocking(network_cost)
                .await
                .unwrap_or(NetworkCost::Unknown);
            if controller.environment(local_minute(), cost) {
                let _ = app.emit("forever://bandwidth", controller.snapshot());
                app.state::<super::ConnectionManager>().bandwidth_changed();
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

#[cfg(test)]
mod tests;
