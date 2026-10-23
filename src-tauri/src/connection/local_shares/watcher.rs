use super::{LocalSharesHub, LocalSharesInner};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};

const DEBOUNCE: Duration = Duration::from_millis(750);
const MAX_DELAY: Duration = Duration::from_secs(5);
const RECONCILE_INTERVAL: Duration = Duration::from_secs(300);
const MAX_PENDING_PATHS: usize = 1024;

#[derive(Default)]
struct Pending {
    paths: HashSet<PathBuf>,
    full: bool,
    first: Option<Instant>,
    last: Option<Instant>,
    error: Option<String>,
}
impl Pending {
    fn record(&mut self, event: notify::Result<Event>, now: Instant) {
        match event {
            Ok(event) => {
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                if event.need_rescan() || event.paths.is_empty() {
                    self.full = true;
                }
                if !self.full {
                    self.paths.extend(event.paths);
                    if self.paths.len() > MAX_PENDING_PATHS {
                        self.full = true;
                    }
                }
            }
            Err(error) => {
                self.full = true;
                self.error = Some(format!(
                    "Folder watching reported an error; periodic rescans remain active: {error}"
                ));
            }
        }
        if self.full {
            self.paths.clear();
        }
        self.first.get_or_insert(now);
        self.last = Some(now);
    }
    fn ready(&self, now: Instant) -> bool {
        self.last
            .is_some_and(|last| now.duration_since(last) >= DEBOUNCE)
            || self
                .first
                .is_some_and(|first| now.duration_since(first) >= MAX_DELAY)
    }
}

fn make_watcher(pending: Arc<Mutex<Pending>>) -> notify::Result<RecommendedWatcher> {
    notify::recommended_watcher(move |event| {
        pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .record(event, Instant::now());
    })
}

pub(super) fn start(inner: Weak<LocalSharesInner>) {
    std::thread::spawn(move || {
        let pending = Arc::new(Mutex::new(Pending::default()));
        let mut watcher = make_watcher(pending.clone());
        let mut watched = HashSet::new();
        let mut configured = Vec::new();
        let mut first = true;
        let mut last_full = Instant::now();
        let mut last_retry = Instant::now();
        loop {
            let Some(inner) = inner.upgrade() else {
                break;
            };
            let hub = LocalSharesHub { inner };
            let roots: Vec<PathBuf> = hub
                .store
                .read()
                .unwrap_or_else(|p| p.into_inner())
                .roots
                .iter()
                .filter(|root| root.enabled)
                .map(|root| PathBuf::from(&root.path))
                .collect();
            let changed = configured != roots;
            let retry = last_retry.elapsed() >= Duration::from_secs(30);
            let mut registration_error = None;
            if first || changed || retry {
                if retry {
                    // Reattach after root deletion/recreation or native handle loss.
                    watcher = make_watcher(pending.clone());
                    watched.clear();
                }
                match &mut watcher {
                    Ok(watcher) => {
                        for path in watched.clone() {
                            if !roots.contains(&path) {
                                let _ = watcher.unwatch(&path);
                                watched.remove(&path);
                            }
                        }
                        for root in &roots {
                            if !watched.contains(root) {
                                match watcher.watch(root, RecursiveMode::Recursive) {
                                    Ok(()) => { watched.insert(root.clone()); },
                                    Err(error) => registration_error = Some(format!("Some folders cannot be watched; rescanning every 5 minutes: {error}")),
                                }
                            }
                        }
                    }
                    Err(error) => {
                        registration_error = Some(format!(
                            "Folder watching unavailable; rescanning every 5 minutes: {error}"
                        ))
                    }
                }
                *hub.watch_status.lock().unwrap_or_else(|p| p.into_inner()) = (
                    !roots.is_empty() && watched.len() == roots.len(),
                    registration_error,
                );
                configured = roots;
                last_retry = Instant::now();
                hub.publish();
            }
            let batch = {
                let mut pending = pending.lock().unwrap_or_else(|p| p.into_inner());
                pending
                    .ready(Instant::now())
                    .then(|| std::mem::take(&mut *pending))
            };
            let full = first
                || changed
                || last_full.elapsed() >= RECONCILE_INTERVAL
                || batch.as_ref().is_some_and(|batch| batch.full);
            if let Some(error) = batch.as_ref().and_then(|batch| batch.error.clone()) {
                *hub.watch_status.lock().unwrap_or_else(|p| p.into_inner()) = (false, Some(error));
            }
            if full {
                let _ = hub.scan();
                last_full = Instant::now();
            } else if let Some(batch) = batch {
                let paths: Vec<_> = batch.paths.into_iter().collect();
                let _ = hub.scan_paths(Some(&paths));
            }
            first = false;
            drop(hub); // The watcher never keeps the application/hub alive.
            std::thread::sleep(Duration::from_millis(200));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_events_update_created_renamed_and_removed_files() {
        use super::super::{reconcile, IndexCache, ShareIndex, SharedRootConfig};
        let temp = tempfile::tempdir().unwrap();
        let root_path = std::fs::canonicalize(temp.path()).unwrap();
        let root = SharedRootConfig {
            id: "live".into(),
            path: root_path.to_string_lossy().into(),
            alias: "Live".into(),
            enabled: true,
            added_at_ms: 0,
        };
        let pending = Arc::new(Mutex::new(Pending::default()));
        let mut watcher = make_watcher(pending.clone()).unwrap();
        watcher.watch(&root_path, RecursiveMode::Recursive).unwrap();
        let mut index = ShareIndex::default();
        let mut apply = |expected: &std::path::Path| {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let mut events = pending.lock().unwrap();
                if events.ready(Instant::now()) && (events.full || events.paths.contains(expected))
                {
                    let batch = std::mem::take(&mut *events);
                    drop(events);
                    let paths: Vec<_> = batch.paths.into_iter().collect();
                    let mut cache = IndexCache::open(std::path::Path::new(":memory:"));
                    index = reconcile(
                        std::slice::from_ref(&root),
                        &index,
                        (!batch.full).then_some(paths.as_slice()),
                        &mut cache,
                    );
                    return index.files.keys().cloned().collect::<Vec<_>>();
                }
                assert!(
                    Instant::now() < deadline,
                    "native event missing for {expected:?}: {:?}",
                    events.paths
                );
                drop(events);
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        let initial = root_path.join("first.txt");
        std::fs::write(&initial, b"release notes").unwrap();
        assert_eq!(apply(&initial), vec!["live\\first.txt"]);
        let renamed = root_path.join("renamed.txt");
        std::fs::rename(&initial, &renamed).unwrap();
        assert_eq!(apply(&renamed), vec!["live\\renamed.txt"]);
        std::fs::remove_file(&renamed).unwrap();
        assert!(apply(&renamed).is_empty());
    }

    #[test]
    fn debounces_bursts_bounds_storms_and_ignores_reads() {
        let now = Instant::now();
        let mut pending = Pending::default();
        pending.record(
            Ok(Event::new(EventKind::Access(
                notify::event::AccessKind::Any,
            ))),
            now,
        );
        assert!(!pending.ready(now + MAX_DELAY));
        for i in 0..=MAX_PENDING_PATHS {
            pending.record(
                Ok(Event::new(EventKind::Any).add_path(PathBuf::from(format!("file-{i}")))),
                now,
            );
        }
        assert!(pending.full && pending.paths.is_empty());
        assert!(!pending.ready(now + DEBOUNCE / 2));
        assert!(pending.ready(now + DEBOUNCE));
        pending.record(
            Ok(Event::new(EventKind::Any)),
            now + MAX_DELAY - DEBOUNCE / 2,
        );
        assert!(pending.ready(now + MAX_DELAY));
    }
}
