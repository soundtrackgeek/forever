//! Bounded session timer producers. Dropping the owner cancels pending sends as
//! well as sleeps, so an old connection cannot feed the next connection's queue.
use std::time::Duration;
use tokio::sync::mpsc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SessionEvent {
    Keepalive,
    Search,
    Network,
    Shares,
    Uploads,
}

pub(super) struct SessionTimer(tokio::task::JoinHandle<()>);

impl Drop for SessionTimer {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) fn spawn(
    period: Duration,
    sender: mpsc::Sender<SessionEvent>,
    event: SessionEvent,
) -> SessionTimer {
    spawn_when(period, sender, move || Some(event))
}

pub(super) fn spawn_when(
    period: Duration,
    sender: mpsc::Sender<SessionEvent>,
    mut next: impl FnMut() -> Option<SessionEvent> + Send + 'static,
) -> SessionTimer {
    SessionTimer(tokio::spawn(async move {
        let mut interval = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if sender.is_closed() {
                return;
            }
            if let Some(event) = next() {
                if sender.send(event).await.is_err() {
                    return;
                }
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn timer_is_bounded_skips_missed_ticks_and_stops_when_session_ends() {
        let (sender, mut receiver) = mpsc::channel(1);
        let timer = spawn(Duration::from_secs(1), sender, SessionEvent::Network);
        tokio::task::yield_now().await;
        assert!(receiver.try_recv().is_err());
        tokio::time::advance(Duration::from_secs(60)).await;
        tokio::task::yield_now().await;
        assert_eq!(receiver.try_recv().unwrap(), SessionEvent::Network);
        tokio::task::yield_now().await;
        assert!(receiver.try_recv().is_err());
        // Fill the queue, then block the producer on its next send.
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        drop(timer);
        tokio::task::yield_now().await;
        assert_eq!(receiver.recv().await, Some(SessionEvent::Network));
        assert_eq!(receiver.recv().await, None);
    }
}
