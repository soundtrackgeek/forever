use super::super::branch::Branch;
use super::super::diagnostics::Diagnostics;
use super::super::distributed::DistributedHub;
use super::super::downloads::TransferHub;
use super::super::folders::FolderHub;
use super::super::local_shares::LocalSharesHub;
use super::super::messages::MessagesHub;
use super::super::people::PeopleHub;
use super::super::protocol::{
    message_acked_frame, parse_excluded_search_phrases, parse_join_room, parse_leave_room,
    parse_private_message, parse_privileged_users, parse_room_chat_message, parse_room_list,
    parse_user_interests, parse_user_joined_room, parse_user_left_room, parse_user_stats,
    parse_user_status, parse_watch_user, parse_wishlist_interval, write_raw_frame, Frame,
    EXCLUDED_SEARCH_PHRASES_CODE, JOIN_ROOM_CODE, LEAVE_ROOM_CODE, MESSAGE_USER_CODE,
    PRIVILEGED_USERS_CODE, ROOM_LIST_CODE, SAY_CHATROOM_CODE, USER_INTERESTS_CODE,
    USER_JOINED_ROOM_CODE, USER_LEFT_ROOM_CODE, USER_STATS_CODE, USER_STATUS_CODE, WATCH_USER_CODE,
    WISHLIST_INTERVAL_CODE,
};
use super::super::radar::RadarHub;
use super::super::reachability::ReachabilityHub;
use super::super::rooms::RoomsHub;
use super::super::search::SearchHub;
use super::super::search_governor::SearchGovernor;
use super::super::shares::SharesHub;
use super::super::uploads::UploadHub;
use super::super::wanted::WantedHub;
use super::session::Session;
use super::{ConnectionCommand, ConnectionFailure, ConnectionManager};
use std::time::Instant;
use tokio::io::AsyncWrite;
use tokio::sync::mpsc;

// Hub registration, frame routing, and connection lifecycle. Socket writes
// remain serialized by Session; handlers return effects after durable work.

#[derive(Clone, Copy)]
pub(super) enum DisconnectReason {
    Requested,
    Interrupted,
}

struct FrameContext<'a> {
    own_username: &'a str,
    people: &'a PeopleHub,
    rooms: &'a RoomsHub,
    wanted: &'a WantedHub,
    diagnostics: &'a Diagnostics,
    command_sender: &'a mpsc::UnboundedSender<ConnectionCommand>,
    branch: &'a mut Branch,
    replies: Vec<Vec<u8>>,
}

// Cross-hub effects are explicit and injectable without a desktop runtime.
trait HubContext {
    fn own_username(&self) -> &str;
    fn is_ignored(&self, username: &str) -> bool;
    fn remember_sender(&mut self, username: &str) -> Result<(), ConnectionFailure>;
    fn room_status(&mut self, username: &str, status: u32);
    fn room_stats(&mut self, stats: &super::super::protocol::UserStats);
    fn upload_speed(&mut self, speed: u32);
    fn publish_wanted(&mut self);
    fn diagnostic(&mut self, level: &str, event: &str, detail: &str);
    fn command(&mut self, command: ConnectionCommand);
    fn reply(&mut self, reply: Vec<u8>);
}

impl HubContext for FrameContext<'_> {
    fn own_username(&self) -> &str {
        self.own_username
    }
    fn is_ignored(&self, username: &str) -> bool {
        self.people.is_ignored(username)
    }
    fn remember_sender(&mut self, username: &str) -> Result<(), ConnectionFailure> {
        self.people.remember(username).map(|_| ()).map_err(|error| {
            ConnectionFailure::retryable(
                format!("The incoming-message sender could not be saved: {error}"),
                "message_store_failed",
            )
        })
    }
    fn room_status(&mut self, username: &str, status: u32) {
        self.rooms.update_status(username, status);
    }
    fn room_stats(&mut self, stats: &super::super::protocol::UserStats) {
        self.rooms.update_stats(stats);
    }
    fn upload_speed(&mut self, speed: u32) {
        self.branch.upload_speed = speed;
    }
    fn publish_wanted(&mut self) {
        self.wanted.publish();
    }
    fn diagnostic(&mut self, level: &str, event: &str, detail: &str) {
        self.diagnostics.record(level, event, detail);
    }
    fn command(&mut self, command: ConnectionCommand) {
        let _ = self.command_sender.send(command);
    }
    fn reply(&mut self, reply: Vec<u8>) {
        self.replies.push(reply);
    }
}

trait ConnectionHub: Send + Sync {
    fn server_codes(&self) -> &'static [u32] {
        &[]
    }
    fn on_server_frame(
        &self,
        _frame: &Frame,
        _context: &mut dyn HubContext,
    ) -> Result<(), ConnectionFailure> {
        Ok(())
    }
    fn on_connected(&self, _commands: &mpsc::UnboundedSender<ConnectionCommand>) {}
    fn on_disconnected(&self, _reason: DisconnectReason) {}
}

pub(super) struct HubRegistry<'a, const N: usize> {
    hubs: [&'a dyn ConnectionHub; N],
}
impl<const N: usize> HubRegistry<'_, N> {
    pub(super) fn connected(&self, commands: &mpsc::UnboundedSender<ConnectionCommand>) {
        for hub in &self.hubs {
            hub.on_connected(commands);
        }
    }
    pub(super) fn disconnected(&self, reason: DisconnectReason) {
        for hub in &self.hubs {
            hub.on_disconnected(reason);
        }
    }
    fn dispatch(
        &self,
        frame: &Frame,
        context: &mut dyn HubContext,
    ) -> Result<bool, ConnectionFailure> {
        let Some(hub) = self
            .hubs
            .iter()
            .find(|hub| hub.server_codes().contains(&frame.code))
        else {
            return Ok(false);
        };
        hub.on_server_frame(frame, context)?;
        Ok(true)
    }
}

impl ConnectionManager {
    pub(super) fn hubs(&self) -> HubRegistry<'_, 14> {
        HubRegistry {
            hubs: [
                &self.search_governor,
                &self.wanted,
                &self.radar,
                &self.search,
                &self.messages,
                &self.rooms,
                &self.people,
                &self.transfers,
                &self.uploads,
                &self.folders,
                &self.shares,
                &self.local_shares,
                &self.distributed,
                &self.reachability,
            ],
        }
    }
}

impl<W: AsyncWrite + Unpin> Session<'_, W> {
    pub(super) async fn dispatch_hub_frame(
        &mut self,
        frame: &Frame,
    ) -> Result<bool, ConnectionFailure> {
        let mut context = FrameContext {
            own_username: &self.profile.username,
            people: &self.manager.people,
            rooms: &self.manager.rooms,
            wanted: &self.manager.wanted,
            diagnostics: &self.manager.diagnostics,
            command_sender: &self.command_sender,
            branch: &mut self.branch,
            replies: Vec::new(),
        };
        let handled = self.manager.hubs().dispatch(frame, &mut context)?;
        for reply in context.replies {
            write_raw_frame(&mut self.writer, &reply)
                .await
                .map_err(|error| {
                    ConnectionFailure::retryable(
                        format!("The private-message acknowledgement failed: {error}"),
                        "message_ack_failed",
                    )
                })?;
        }
        Ok(handled)
    }
}

impl ConnectionHub for UploadHub {
    fn server_codes(&self) -> &'static [u32] {
        &[PRIVILEGED_USERS_CODE]
    }
    fn on_server_frame(
        &self,
        frame: &Frame,
        context: &mut dyn HubContext,
    ) -> Result<(), ConnectionFailure> {
        if frame.code == PRIVILEGED_USERS_CODE {
            match parse_privileged_users(frame) {
                Ok(users) => {
                    self.set_privileged(users);
                    context.command(ConnectionCommand::ScheduleUploads);
                }
                Err(_) => context.diagnostic(
                    "warning",
                    "privileged_users_invalid",
                    "Invalid privileged-user list; keeping the last valid list for this session.",
                ),
            }
        }
        Ok(())
    }
    fn on_connected(&self, commands: &mpsc::UnboundedSender<ConnectionCommand>) {
        let _ = commands.send(ConnectionCommand::ScheduleUploads);
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
        self.set_privileged(Vec::new());
    }
}

impl ConnectionHub for SearchGovernor {
    fn server_codes(&self) -> &'static [u32] {
        &[WISHLIST_INTERVAL_CODE]
    }
    fn on_server_frame(
        &self,
        frame: &Frame,
        context: &mut dyn HubContext,
    ) -> Result<(), ConnectionFailure> {
        if frame.code == WISHLIST_INTERVAL_CODE {
            match parse_wishlist_interval(frame) {
                    Ok(seconds) => {
                        self.set_wishlist_interval(seconds, Instant::now());
                        context.publish_wanted();
                    }
                    Err(_) => context.diagnostic(
                        "warning", "wishlist_interval_invalid",
                        "The server sent an invalid wishlist interval; the last valid interval remains active.",
                    ),
                }
        }
        Ok(())
    }
    fn on_connected(&self, _commands: &mpsc::UnboundedSender<ConnectionCommand>) {
        self.set_online(true);
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.set_online(false);
    }
}

impl ConnectionHub for LocalSharesHub {
    fn server_codes(&self) -> &'static [u32] {
        &[EXCLUDED_SEARCH_PHRASES_CODE]
    }
    fn on_server_frame(
        &self,
        frame: &Frame,
        context: &mut dyn HubContext,
    ) -> Result<(), ConnectionFailure> {
        if frame.code == EXCLUDED_SEARCH_PHRASES_CODE {
            match parse_excluded_search_phrases(frame) {
                    Ok(phrases) => self.set_excluded_phrases(phrases),
                    Err(_) => context.diagnostic(
                        "warning",
                        "excluded_phrases_invalid",
                        "The server sent an invalid excluded-phrase list; the last valid list remains active.",
                    ),
                }
        }
        Ok(())
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
    }
}

impl ConnectionHub for RoomsHub {
    fn server_codes(&self) -> &'static [u32] {
        &[
            ROOM_LIST_CODE,
            JOIN_ROOM_CODE,
            LEAVE_ROOM_CODE,
            USER_JOINED_ROOM_CODE,
            USER_LEFT_ROOM_CODE,
            SAY_CHATROOM_CODE,
        ]
    }
    fn on_server_frame(
        &self,
        frame: &Frame,
        context: &mut dyn HubContext,
    ) -> Result<(), ConnectionFailure> {
        match frame.code {
            ROOM_LIST_CODE => {
                if let Ok(rooms) = parse_room_list(frame) {
                    self.update_list(rooms);
                }
            }
            JOIN_ROOM_CODE => {
                if let Ok(room) = parse_join_room(frame) {
                    let _ = self.joined(room);
                }
            }
            LEAVE_ROOM_CODE => {
                if let Ok(room) = parse_leave_room(frame) {
                    let _ = self.left(&room);
                }
            }
            USER_JOINED_ROOM_CODE => {
                if let Ok((room, member)) = parse_user_joined_room(frame) {
                    let _ = self.user_joined(&room, member);
                }
            }
            USER_LEFT_ROOM_CODE => {
                if let Ok((room, username)) = parse_user_left_room(frame) {
                    let _ = self.user_left(&room, &username);
                }
            }
            SAY_CHATROOM_CODE => {
                if let Ok(message) = parse_room_chat_message(frame) {
                    if !context.is_ignored(&message.username) {
                        let _ = self.record_message(
                            &message.room,
                            &message.username,
                            &message.message,
                            context.own_username(),
                        );
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn on_connected(&self, commands: &mpsc::UnboundedSender<ConnectionCommand>) {
        self.connected();
        let _ = commands.send(ConnectionCommand::RefreshRooms);
        for room in self.desired_rooms() {
            let _ = commands.send(ConnectionCommand::JoinRoom { room });
        }
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.disconnected();
    }
}

impl ConnectionHub for MessagesHub {
    fn server_codes(&self) -> &'static [u32] {
        &[MESSAGE_USER_CODE]
    }
    fn on_server_frame(
        &self,
        frame: &Frame,
        context: &mut dyn HubContext,
    ) -> Result<(), ConnectionFailure> {
        if frame.code == MESSAGE_USER_CODE {
            if let Ok(message) = parse_private_message(frame) {
                if !context.is_ignored(&message.username) {
                    context.remember_sender(&message.username)?;
                    self.record_incoming(
                        message.id,
                        message.timestamp_seconds,
                        &message.username,
                        &message.message,
                    )
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The incoming private message could not be saved: {error}"),
                            "message_store_failed",
                        )
                    })?;
                }
                context.reply(message_acked_frame(message.id));
            }
        }
        Ok(())
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        let _ = self.fail_queued("The Soulseek connection ended before this message was sent.");
    }
}

impl ConnectionHub for PeopleHub {
    fn server_codes(&self) -> &'static [u32] {
        &[
            WATCH_USER_CODE,
            USER_STATUS_CODE,
            USER_STATS_CODE,
            USER_INTERESTS_CODE,
        ]
    }
    fn on_server_frame(
        &self,
        frame: &Frame,
        context: &mut dyn HubContext,
    ) -> Result<(), ConnectionFailure> {
        match frame.code {
            WATCH_USER_CODE => {
                if let Ok(watched) = parse_watch_user(frame) {
                    self.update_watch(watched);
                }
            }
            USER_STATUS_CODE => {
                if let Ok((username, status, privileged)) = parse_user_status(frame) {
                    context.room_status(&username, status);
                    self.update_status(&username, status, privileged);
                }
            }
            USER_STATS_CODE => {
                if let Ok(stats) = parse_user_stats(frame) {
                    if stats.username.eq_ignore_ascii_case(context.own_username()) {
                        context.upload_speed(stats.average_speed);
                    }
                    context.room_stats(&stats);
                    self.update_stats(stats);
                }
            }
            USER_INTERESTS_CODE => {
                if let Ok(interests) = parse_user_interests(frame) {
                    self.update_interests(interests);
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn on_connected(&self, commands: &mpsc::UnboundedSender<ConnectionCommand>) {
        for username in self.saved_users_to_watch() {
            let _ = commands.send(ConnectionCommand::WatchPerson { username });
        }
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
    }
}

impl ConnectionHub for TransferHub {
    fn on_connected(&self, _commands: &mpsc::UnboundedSender<ConnectionCommand>) {
        self.wake_scheduler();
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
    }
}

impl ConnectionHub for FolderHub {
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
    }
}

impl ConnectionHub for SharesHub {
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
    }
}

impl ConnectionHub for WantedHub {
    fn on_connected(&self, _commands: &mpsc::UnboundedSender<ConnectionCommand>) {
        self.publish();
    }
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
    }
}

impl ConnectionHub for RadarHub {
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.connection_lost();
    }
}

impl ConnectionHub for SearchHub {
    fn on_disconnected(&self, reason: DisconnectReason) {
        match reason {
            DisconnectReason::Requested => {
                self.stop_all();
            }
            DisconnectReason::Interrupted => {
                self.fail_all("Search stopped because the Soulseek connection was interrupted.")
            }
        }
    }
}

impl ConnectionHub for DistributedHub {
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.offline();
    }
}

impl ConnectionHub for ReachabilityHub {
    fn on_disconnected(&self, _reason: DisconnectReason) {
        self.offline();
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::{
        search_governor::SearchLane, store::JsonFile, upload_policy::UploadPolicy,
    };
    use super::*;
    use std::sync::Arc;

    #[derive(Default)]
    struct Context {
        publishes: usize,
        diagnostics: Vec<String>,
        commands: Vec<ConnectionCommand>,
    }
    impl HubContext for Context {
        fn own_username(&self) -> &str {
            "forever"
        }
        fn is_ignored(&self, _: &str) -> bool {
            false
        }
        fn remember_sender(&mut self, _: &str) -> Result<(), ConnectionFailure> {
            Ok(())
        }
        fn room_status(&mut self, _: &str, _: u32) {}
        fn room_stats(&mut self, _: &super::super::super::protocol::UserStats) {}
        fn upload_speed(&mut self, _: u32) {}
        fn publish_wanted(&mut self) {
            self.publishes += 1;
        }
        fn diagnostic(&mut self, _: &str, event: &str, _: &str) {
            self.diagnostics.push(event.into());
        }
        fn command(&mut self, command: ConnectionCommand) {
            self.commands.push(command);
        }
        fn reply(&mut self, _: Vec<u8>) {}
    }

    #[test]
    fn dispatcher_routes_valid_malformed_and_unknown_frames_without_resetting_state() {
        let governor = SearchGovernor::default();
        let registry = HubRegistry { hubs: [&governor] };
        let (sender, _receiver) = mpsc::unbounded_channel();
        registry.connected(&sender);
        let mut context = Context::default();
        assert!(registry
            .dispatch(
                &Frame {
                    code: WISHLIST_INTERVAL_CODE,
                    payload: 120_u32.to_le_bytes().to_vec()
                },
                &mut context
            )
            .unwrap());
        assert_eq!(governor.wishlist_seconds(), Some(120));
        assert_eq!(context.publishes, 1);
        assert!(registry
            .dispatch(
                &Frame {
                    code: WISHLIST_INTERVAL_CODE,
                    payload: vec![1, 2]
                },
                &mut context
            )
            .unwrap());
        assert_eq!(governor.wishlist_seconds(), Some(120));
        assert_eq!(context.publishes, 1);
        assert_eq!(context.diagnostics, ["wishlist_interval_invalid"]);
        assert!(!registry
            .dispatch(
                &Frame {
                    code: u32::MAX,
                    payload: vec![]
                },
                &mut context
            )
            .unwrap());
        for reason in [DisconnectReason::Requested, DisconnectReason::Interrupted] {
            registry.disconnected(reason);
            assert_eq!(governor.wishlist_seconds(), None);
            assert!(!governor.ready(SearchLane::User, Instant::now()));
            registry.connected(&sender);
            assert!(governor.ready(SearchLane::User, Instant::now()));
            assert!(!governor.ready(SearchLane::Wanted, Instant::now()));
        }
    }

    #[test]
    fn upload_frame_and_both_disconnect_paths_clear_session_privileges_and_requeue() {
        use super::super::super::{local_shares::IndexedFile, uploads::UploadStatus};
        for reason in [DisconnectReason::Requested, DisconnectReason::Interrupted] {
            let dir = tempfile::tempdir().unwrap();
            let hub = UploadHub::load(
                Arc::new(|_| {}),
                JsonFile::new(dir.path().join("uploads.json")),
                UploadPolicy::default(),
            );
            for username in ["alice", "bob"] {
                hub.enqueue(
                    username,
                    IndexedFile {
                        local_path: dir.path().join("track.flac"),
                        remote_filename: "Music\\track.flac".into(),
                        filename: "track.flac".into(),
                        size_bytes: 100,
                        extension: "flac".into(),
                        quality: Default::default(),
                    },
                )
                .unwrap();
            }
            let registry = HubRegistry { hubs: [&hub] };
            let mut context = Context::default();
            let mut payload = 1_u32.to_le_bytes().to_vec();
            payload.extend(3_u32.to_le_bytes());
            payload.extend(b"bob");
            registry
                .dispatch(
                    &Frame {
                        code: PRIVILEGED_USERS_CODE,
                        payload,
                    },
                    &mut context,
                )
                .unwrap();
            assert!(matches!(
                context.commands.as_slice(),
                [ConnectionCommand::ScheduleUploads]
            ));
            // A malformed replacement retains the prior server list.
            registry
                .dispatch(
                    &Frame {
                        code: PRIVILEGED_USERS_CODE,
                        payload: vec![255; 4],
                    },
                    &mut context,
                )
                .unwrap();
            assert_eq!(context.diagnostics, ["privileged_users_invalid"]);
            registry.disconnected(reason);
            let active = hub.activate_next(1, 1).unwrap();
            assert_eq!(
                active.username, "alice",
                "session privilege must not survive disconnect"
            );
            registry.disconnected(reason);
            assert!(hub
                .snapshot()
                .uploads
                .iter()
                .all(|u| u.status == UploadStatus::Queued));
            assert!(!hub.fail_attempt(&active.id, active.transfer_token, "stale callback".into()));
            let restored = UploadHub::load(
                Arc::new(|_| {}),
                JsonFile::new(dir.path().join("uploads.json")),
                UploadPolicy::default(),
            );
            assert_eq!(restored.queued_count(), 2);
        }
    }
}
