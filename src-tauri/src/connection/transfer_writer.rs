use std::{
    sync::{Arc, Condvar, Mutex},
    thread,
};

// One in-flight write and one replaceable pending snapshot. Serialization and
// disk I/O run exclusively on this thread, never on a network executor thread.
pub(super) struct TransferWriter<T> {
    shared: Arc<(Mutex<WriterState<T>>, Condvar)>,
}

struct WriterState<T> {
    pending: Option<(u64, T)>,
    requested: u64,
    completed: u64,
    error: Option<String>,
    closed: bool,
}

impl<T: Send + 'static> TransferWriter<T> {
    pub fn new(
        mut write: impl FnMut(T) -> Result<(), String> + Send + 'static,
        mut report: impl FnMut(Option<String>) + Send + 'static,
    ) -> Result<Self, std::io::Error> {
        let shared = Arc::new((
            Mutex::new(WriterState {
                pending: None,
                requested: 0,
                completed: 0,
                error: None,
                closed: false,
            }),
            Condvar::new(),
        ));
        let worker = shared.clone();
        thread::Builder::new()
            .name("forever-transfer-store".into())
            .spawn(move || loop {
                let (lock, wake) = &*worker;
                let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
                while state.pending.is_none() && !state.closed {
                    state = wake.wait(state).unwrap_or_else(|p| p.into_inner());
                }
                let Some((revision, store)) = state.pending.take() else {
                    break;
                };
                drop(state);
                let error = write(store).err();
                let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
                let changed = state.error != error;
                state.error = error.clone();
                state.completed = revision;
                wake.notify_all();
                drop(state);
                if changed {
                    report(error);
                }
            })?;
        Ok(Self { shared })
    }

    pub fn submit(&self, store: T) {
        let (lock, wake) = &*self.shared;
        let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
        state.requested += 1;
        state.pending = Some((state.requested, store));
        wake.notify_all();
    }

    pub fn error(&self) -> Option<String> {
        self.shared
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .error
            .clone()
    }

    // Called via spawn_blocking at the Safe Passage boundary. A failed save
    // must prevent exit/restart instead of silently losing the durable queue.
    pub fn flush(&self) -> Result<(), String> {
        let (lock, wake) = &*self.shared;
        let mut state = lock.lock().unwrap_or_else(|p| p.into_inner());
        while state.completed < state.requested {
            state = wake.wait(state).unwrap_or_else(|p| p.into_inner());
        }
        state.error.clone().map_or(Ok(()), Err)
    }
}

impl<T> Drop for TransferWriter<T> {
    fn drop(&mut self) {
        let (lock, wake) = &*self.shared;
        lock.lock().unwrap_or_else(|p| p.into_inner()).closed = true;
        wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn coalesces_pending_snapshots_and_flushes_the_latest_off_thread() {
        let caller = thread::current().id();
        let (started, wait_started) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let writes = Arc::new(Mutex::new(Vec::new()));
        let written = writes.clone();
        let writer = TransferWriter::new(
            move |value| {
                assert_ne!(caller, thread::current().id());
                if value == 1 {
                    started.send(()).unwrap();
                    wait_release.recv().unwrap();
                }
                written.lock().unwrap().push(value);
                Ok(())
            },
            |_| {},
        )
        .unwrap();
        writer.submit(1);
        wait_started.recv().unwrap();
        for value in 2..=100 {
            writer.submit(value);
        }
        release.send(()).unwrap();
        writer.flush().unwrap();
        assert_eq!(*writes.lock().unwrap(), vec![1, 100]);
    }

    #[test]
    fn reports_failure_and_recovery_and_flush_does_not_hide_errors() {
        let (report, reports) = mpsc::channel();
        let writer = TransferWriter::new(
            |fail| {
                if fail {
                    Err("disk full".into())
                } else {
                    Ok(())
                }
            },
            move |error| report.send(error).unwrap(),
        )
        .unwrap();
        writer.submit(true);
        assert_eq!(writer.flush(), Err("disk full".into()));
        assert_eq!(reports.recv().unwrap(), Some("disk full".into()));
        writer.submit(false);
        writer.flush().unwrap();
        assert_eq!(reports.recv().unwrap(), None);
    }
}
