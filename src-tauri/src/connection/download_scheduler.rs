//! Coalesced lifecycle notifications and one retry deadline. Progress telemetry
//! never wakes this scheduler; idle queues have no timer.
use std::{sync::Arc, time::Duration};
use tokio::sync::Notify;

#[derive(Clone, Default)]
pub(super) struct DownloadScheduler(Arc<Notify>);

impl DownloadScheduler {
    pub(super) fn changed(&self) {
        self.0.notify_one();
    }

    pub(super) async fn wait(&self, delay: Option<Duration>) {
        tokio::select! {
            _ = self.0.notified() => {},
            _ = async {
                match delay {
                    Some(delay) => tokio::time::sleep(delay).await,
                    None => std::future::pending().await,
                }
            } => {},
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{future::Future, task::Poll};

    async fn assert_pending(mut future: std::pin::Pin<&mut impl Future>) {
        std::future::poll_fn(|cx| {
            assert!(future.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
    }

    #[tokio::test(start_paused = true)]
    async fn idle_has_no_poll_and_notifications_coalesce_without_lost_wakeups() {
        let scheduler = DownloadScheduler::default();
        let mut idle = Box::pin(scheduler.wait(None));
        assert_pending(idle.as_mut()).await;
        tokio::time::advance(Duration::from_secs(3600)).await;
        assert_pending(idle.as_mut()).await;
        for _ in 0..100 {
            scheduler.changed();
        }
        idle.await;
        // Notify retains one permit in addition to the waiter already woken.
        // A burst therefore costs at most one further scheduler pass.
        scheduler.wait(None).await;
        let mut next = Box::pin(scheduler.wait(None));
        assert_pending(next.as_mut()).await;
        // A wake before registering a new waiter must also survive.
        drop(next);
        scheduler.changed();
        scheduler.wait(None).await;
    }

    #[tokio::test(start_paused = true)]
    async fn lifecycle_change_replaces_a_later_retry_deadline() {
        let scheduler = DownloadScheduler::default();
        let mut later = Box::pin(scheduler.wait(Some(Duration::from_secs(45))));
        assert_pending(later.as_mut()).await;
        scheduler.changed();
        later.await;
        let mut earlier = Box::pin(scheduler.wait(Some(Duration::from_secs(5))));
        assert_pending(earlier.as_mut()).await;
        tokio::time::advance(Duration::from_secs(4)).await;
        assert_pending(earlier.as_mut()).await;
        tokio::time::advance(Duration::from_secs(1)).await;
        earlier.await;
    }
}
