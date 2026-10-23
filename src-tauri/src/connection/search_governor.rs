use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

// One send budget for all locally initiated network searches. This is a local
// conservative policy, not a claim about the server's ordinary-search limit.
pub const SEARCH_SPACING: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchLane {
    User,
    Relay,
    Radar,
    Wanted,
}

pub const PRIORITY: [SearchLane; 4] = [
    SearchLane::User,
    SearchLane::Relay,
    SearchLane::Radar,
    SearchLane::Wanted,
];

#[derive(Default)]
struct Budget {
    online: bool,
    wishlist_seconds: Option<u32>,
    wishlist_announced_at: Option<Instant>,
    last_send: Option<Instant>,
    last_wishlist: Option<Instant>,
}

impl Budget {
    fn next_slot(&self, lane: SearchLane, now: Instant) -> Option<Instant> {
        if !self.online {
            return None;
        }
        let ordinary = self.last_send.map_or(now, |sent| sent + SEARCH_SPACING);
        if lane != SearchLane::Wanted {
            return Some(ordinary.max(now));
        }
        let seconds = self.wishlist_seconds.filter(|seconds| *seconds > 0)?;
        // Wait a full server interval after the first announcement. Repeated
        // announcements do not reset the clock or allow a burst after reconnect.
        let anchor = self.last_wishlist.or(self.wishlist_announced_at)?;
        Some(
            ordinary
                .max(anchor + Duration::from_secs(u64::from(seconds)))
                .max(now),
        )
    }
}

#[derive(Clone, Default)]
pub struct SearchGovernor(Arc<Mutex<Budget>>);

impl SearchGovernor {
    pub fn take_next<T>(
        &self,
        now: Instant,
        mut pending: impl FnMut(SearchLane) -> Option<T>,
    ) -> Option<(SearchLane, T)> {
        for lane in PRIORITY {
            if self.ready(lane, now) {
                if let Some(request) = pending(lane) {
                    self.sent(lane, now);
                    return Some((lane, request));
                }
            }
        }
        None
    }

    pub fn set_online(&self, online: bool) {
        let mut budget = self.0.lock().unwrap_or_else(|p| p.into_inner());
        budget.online = online;
        budget.wishlist_seconds = None;
        budget.wishlist_announced_at = None;
        // Keep send history across reconnects within this app session.
    }

    pub fn set_wishlist_interval(&self, seconds: u32, now: Instant) {
        let mut budget = self.0.lock().unwrap_or_else(|p| p.into_inner());
        budget.wishlist_seconds = Some(seconds);
        budget.wishlist_announced_at.get_or_insert(now);
    }

    pub fn wishlist_seconds(&self) -> Option<u32> {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .wishlist_seconds
    }

    pub fn next_slot(&self, lane: SearchLane, now: Instant) -> Option<Instant> {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .next_slot(lane, now)
    }

    pub fn ready(&self, lane: SearchLane, now: Instant) -> bool {
        self.next_slot(lane, now).is_some_and(|slot| slot <= now)
    }

    // Called only by the connection actor at the single search-write site.
    pub fn sent(&self, lane: SearchLane, now: Instant) {
        let mut budget = self.0.lock().unwrap_or_else(|p| p.into_inner());
        budget.last_send = Some(now);
        if lane == SearchLane::Wanted {
            budget.last_wishlist = Some(now);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_producers_follow_priority_and_share_one_budget_without_catch_up() {
        let governor = SearchGovernor::default();
        let start = Instant::now();
        governor.set_online(true);
        governor.set_wishlist_interval(120, start);
        let now = start + Duration::from_secs(720);
        let mut pending = vec![
            SearchLane::Wanted,
            SearchLane::Radar,
            SearchLane::Relay,
            SearchLane::User,
        ];
        for (index, expected) in PRIORITY.into_iter().enumerate() {
            let time = now + SEARCH_SPACING * index as u32;
            let selected = governor.take_next(time, |lane| {
                pending
                    .iter()
                    .position(|p| *p == lane)
                    .map(|pos| pending.remove(pos))
            });
            assert_eq!(selected, Some((expected, expected)));
            assert!(governor.take_next(time, |_| Some(())).is_none());
        }
        assert!(pending.is_empty());
        assert!(governor
            .take_next(now + Duration::from_secs(20), |_| None::<()>)
            .is_none());
        // Empty queues do not spend a slot.
        assert!(governor.ready(SearchLane::User, now + Duration::from_secs(20)));
    }

    #[test]
    fn every_lane_shares_spacing_and_wishlist_requires_server_permission() {
        let governor = SearchGovernor::default();
        let now = Instant::now();
        assert!(!governor.ready(SearchLane::User, now));
        governor.set_online(true);
        assert!(!governor.ready(SearchLane::Wanted, now));
        governor.set_wishlist_interval(120, now);
        assert!(!governor.ready(SearchLane::Wanted, now + Duration::from_secs(119)));
        assert!(governor.ready(SearchLane::Wanted, now + Duration::from_secs(120)));
        governor.sent(SearchLane::Wanted, now + Duration::from_secs(120));
        for lane in PRIORITY {
            assert!(!governor.ready(lane, now + Duration::from_secs(124)));
        }
        assert!(governor.ready(SearchLane::User, now + Duration::from_secs(125)));
        assert!(!governor.ready(SearchLane::Wanted, now + Duration::from_secs(239)));
        assert!(governor.ready(SearchLane::Wanted, now + Duration::from_secs(240)));
    }

    #[test]
    fn interval_updates_zero_reconnect_and_long_stalls_do_not_burst() {
        let governor = SearchGovernor::default();
        let now = Instant::now();
        governor.set_online(true);
        governor.set_wishlist_interval(120, now);
        governor.sent(SearchLane::Wanted, now);
        governor.set_wishlist_interval(720, now + Duration::from_secs(10));
        assert!(!governor.ready(SearchLane::Wanted, now + Duration::from_secs(719)));
        governor.set_wishlist_interval(0, now);
        assert!(!governor.ready(SearchLane::Wanted, now + Duration::from_secs(10_000)));
        governor.set_online(false);
        governor.set_online(true);
        assert!(!governor.ready(SearchLane::Wanted, now));
        governor.set_wishlist_interval(720, now);
        assert!(!governor.ready(SearchLane::Wanted, now + Duration::from_secs(719)));
        let late = now + Duration::from_secs(10_000);
        assert!(governor.ready(SearchLane::Wanted, late));
        governor.sent(SearchLane::Wanted, late);
        assert!(!governor.ready(SearchLane::Wanted, late + Duration::from_secs(719)));
        governor.set_wishlist_interval(u32::MAX, late);
        assert!(!governor.ready(SearchLane::Wanted, late));
    }
}
