use super::super::branch::{Branch, ChildCandidate};
use super::super::protocol::{
    login_frame, parse_login_response, read_frame, server_ping_frame, set_online_frame,
    set_wait_port_frame, shared_counts_frame, user_stats_frame, write_raw_frame, Frame,
    LoginResponse, ProtocolError,
};
use super::super::reachability::{bind_listener, DirectStatus};
use super::super::session_timer::SessionEvent;
use super::super::settings::ConnectionProfile;
use super::network::{DistributedCoordinator, DistributedPeerEvent};
use super::peers::spawn_direct_peer;
use super::{
    rejection_failure, server_label, timestamp_ms, AbortOnDrop, ConnectionCommand,
    ConnectionFailure, ConnectionManager, ConnectionSnapshot, ConnectionState, CONNECT_TIMEOUT,
    DISTRIBUTED_EVENT_QUEUE_SIZE, KEEPALIVE_INTERVAL, LOGIN_TIMEOUT, MAX_CONCURRENT_PEERS,
    SERVER_FRAME_QUEUE_SIZE,
};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Semaphore};
use tokio::time::timeout;
use zeroize::Zeroizing;

// Authentication and session event pump.

// One writer and one topology owner per authenticated connection. Handlers can
// mutate this state without spawning competing server writers.
pub(super) struct Session<'a, W> {
    pub manager: &'a ConnectionManager,
    pub profile: &'a ConnectionProfile,
    pub writer: W,
    pub coordinator: DistributedCoordinator,
    pub branch: Branch,
    pub accepting_children: bool,
    pub advertised_port: u16,
    pub listen_port: u16,
    pub reachability_id: u64,
    pub command_sender: mpsc::UnboundedSender<ConnectionCommand>,
    pub distributed_event_sender: mpsc::Sender<DistributedPeerEvent>,
    pub child_sender: mpsc::Sender<ChildCandidate>,
    pub peer_limit: Arc<Semaphore>,
}

impl<W: AsyncWrite + Unpin> Session<'_, W> {
    async fn on_timer(&mut self, event: SessionEvent) -> Result<(), ConnectionFailure> {
        match event {
            SessionEvent::Keepalive => write_raw_frame(&mut self.writer, &server_ping_frame())
                .await
                .map_err(|error| {
                    ConnectionFailure::retryable(
                        format!("The Soulseek keepalive failed: {error}"),
                        "keepalive_failed",
                    )
                })?,
            SessionEvent::Search => {
                self.manager
                    .search
                    .expire_if_due(&self.manager.next_search_token);
                self.manager
                    .wanted
                    .expire_if_due(&self.manager.next_search_token);
                self.manager.radar.expire_if_due();
                self.manager.dispatch_search(&mut self.writer).await?;
            }
            SessionEvent::Network => self.maintain_network().await?,
            SessionEvent::Shares => {
                self.on_command(Some(ConnectionCommand::RefreshSharedCounts))
                    .await?
            }
            SessionEvent::Uploads => {
                self.manager.uploads.retry_save();
                if self.manager.uploads.queued_count() > 0
                    && self
                        .manager
                        .uploads
                        .has_free_slot(self.manager.local_shares.upload_slots())
                {
                    self.on_command(Some(ConnectionCommand::ScheduleUploads))
                        .await?;
                }
            }
        }
        Ok(())
    }
}

impl ConnectionManager {
    pub(super) async fn connect_once(
        &self,
        profile: &ConnectionProfile,
        password: &str,
        attempt: u32,
    ) -> Result<(), ConnectionFailure> {
        let address = (profile.server_host.as_str(), profile.server_port);
        let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(address))
            .await
            .map_err(|_| {
                ConnectionFailure::retryable(
                    "The Soulseek server did not respond in time.",
                    "connect_timeout",
                )
            })?
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Could not reach the Soulseek server: {error}"),
                    "connect_failed",
                )
            })?;
        let _ = stream.set_nodelay(true);

        self.publish(ConnectionSnapshot {
            state: ConnectionState::Authenticating,
            username: Some(profile.username.clone()),
            server: Some(server_label(profile)),
            message: "Signing in to Soulseek…".to_owned(),
            attempt,
            connected_at_ms: None,
            retry_in_seconds: None,
            updated_at_ms: timestamp_ms(),
        });

        let login = Zeroizing::new(login_frame(&profile.username, password));
        write_raw_frame(&mut stream, login.as_slice())
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Could not send the Soulseek login: {error}"),
                    "login_send_failed",
                )
            })?;
        let response = timeout(LOGIN_TIMEOUT, read_frame(&mut stream))
            .await
            .map_err(|_| {
                ConnectionFailure::retryable(
                    "The Soulseek server did not answer the login request.",
                    "login_timeout",
                )
            })?
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Could not read the Soulseek login response: {error}"),
                    "login_read_failed",
                )
            })?;

        match parse_login_response(&response).map_err(|error| {
            ConnectionFailure::fatal(
                format!("The Soulseek server sent an unexpected login response: {error}"),
                "login_protocol_error",
            )
        })? {
            LoginResponse::Accepted { .. } => {}
            LoginResponse::Rejected { reason, detail } => {
                return Err(rejection_failure(&reason, detail.as_deref()));
            }
        }

        let listener = bind_listener(profile.listen_port).await.map_err(|error| {
            ConnectionFailure::retryable(
                format!("Forever could not open a peer listening port: {error}"),
                "listen_failed",
            )
        })?;
        let listen_port = listener
            .local_addr()
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Forever could not inspect its peer listening port: {error}"),
                    "listen_failed",
                )
            })?
            .port();
        let local_ip = stream
            .local_addr()
            .map_err(|error| ConnectionFailure::retryable(error.to_string(), "listen_failed"))?
            .ip();
        let reachability_session =
            self.reachability
                .begin(profile, listen_port, local_ip, self.diagnostics.clone());
        write_raw_frame(&mut stream, &set_wait_port_frame(listen_port))
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The Soulseek peer listener could not be announced: {error}"),
                    "session_setup_failed",
                )
            })?;
        write_raw_frame(&mut stream, &set_online_frame())
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The Soulseek session could not be initialized: {error}"),
                    "session_setup_failed",
                )
            })?;
        let (shared_directories, shared_files) = self.local_shares.counts();
        write_raw_frame(
            &mut stream,
            &shared_counts_frame(shared_directories, shared_files),
        )
        .await
        .map_err(|error| {
            ConnectionFailure::retryable(
                format!("The Soulseek session could not be initialized: {error}"),
                "session_setup_failed",
            )
        })?;

        // `read_frame` uses `read_exact`, which is not cancellation-safe. Keep it
        // out of the busy select loop so timer/listener/command branches cannot
        // discard a partially consumed server frame and desynchronize the socket.
        let (server_reader, mut server_writer) = stream.into_split();
        let (server_frame_sender, mut server_frame_receiver) =
            mpsc::channel(SERVER_FRAME_QUEUE_SIZE);
        let _server_reader_task = AbortOnDrop(tauri::async_runtime::spawn(forward_server_frames(
            server_reader,
            server_frame_sender,
        )));

        let (command_sender, mut command_receiver) = mpsc::unbounded_channel();
        *self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(command_sender.clone());

        let (distributed_event_sender, mut distributed_event_receiver) =
            mpsc::channel(DISTRIBUTED_EVENT_QUEUE_SIZE);
        let (child_sender, mut child_receiver) = mpsc::channel::<ChildCandidate>(8);
        self.announce_no_distributed_parent(&mut server_writer, &profile.username)
            .await?;
        self.distributed.begin_discovery();
        self.diagnostics.record(
            "info",
            "distributed_discovery",
            "Looking for a global-search relay.",
        );

        let connected_at_ms = timestamp_ms();
        self.diagnostics.record(
            "info",
            "connected",
            "Authenticated with the Soulseek server.",
        );
        self.publish(ConnectionSnapshot {
            state: ConnectionState::Online,
            username: Some(profile.username.clone()),
            server: Some(server_label(profile)),
            message: "Network online".to_owned(),
            attempt,
            connected_at_ms: Some(connected_at_ms),
            retry_in_seconds: None,
            updated_at_ms: connected_at_ms,
        });
        let hubs = self.hubs();
        hubs.connected(&command_sender);
        write_raw_frame(&mut server_writer, &user_stats_frame(&profile.username))
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(error.to_string(), "session_setup_failed")
            })?;
        let peer_limit = Arc::new(Semaphore::new(MAX_CONCURRENT_PEERS));
        let mut session = Session {
            manager: self,
            profile,
            writer: server_writer,
            coordinator: DistributedCoordinator::new(),
            branch: Branch::new(),
            accepting_children: false,
            advertised_port: listen_port,
            listen_port,
            reachability_id: reachability_session.id,
            command_sender,
            distributed_event_sender,
            child_sender,
            peer_limit,
        };
        let (event_sender, mut event_receiver) = mpsc::channel(8);
        // Every producer is scoped to this connection attempt and aborted on exit.
        let _timers = [
            self.search_governor
                .start_session_timer(event_sender.clone()),
            self.local_shares
                .start_session_timer(event_sender.clone(), (shared_directories, shared_files)),
            self.uploads.start_session_timer(event_sender.clone()),
            self.reachability.start_session_timer(event_sender.clone()),
            super::super::session_timer::spawn(
                KEEPALIVE_INTERVAL,
                event_sender,
                SessionEvent::Keepalive,
            ),
        ];
        let mut download_wake =
            Box::pin(self.transfers.scheduling_changed(self.bandwidth.paused()));
        loop {
            tokio::select! {
                frame = server_frame_receiver.recv() => {
                    let frame = match frame {
                        Some(Ok(frame)) => frame,
                        Some(Err(error)) => return Err(ConnectionFailure::retryable(
                            format!("The Soulseek connection was interrupted: {error}"), "socket_interrupted")),
                        None => return Err(ConnectionFailure::retryable(
                            "The Soulseek server reader stopped unexpectedly.", "socket_interrupted")),
                    };
                    session.on_server_frame(frame).await?;
                }
                Some(event) = distributed_event_receiver.recv() => session.on_distributed_event(event).await?,
                Some(candidate) = child_receiver.recv() => {
                    session.branch.refresh(profile.allow_distributed_children, self.reachability.snapshot().status == DirectStatus::Reachable);
                    if !self.people.is_blocked(&candidate.username) {
                        session.branch.add(candidate, &profile.username, session.coordinator.parent_username());
                    }
                }
                accepted = listener.accept() => {
                    let (peer_stream, address) = accepted.map_err(|error| ConnectionFailure::retryable(
                        format!("The Soulseek peer listener stopped: {error}"), "listen_failed"))?;
                    self.reachability.incoming(reachability_session.id, address.ip());
                    spawn_direct_peer(peer_stream, self.peer_services(&profile.username, &session.command_sender), session.peer_limit.clone(), session.child_sender.clone());
                }
                command = command_receiver.recv() => session.on_command(command).await?,
                _ = &mut download_wake => {
                    session.on_command(Some(ConnectionCommand::ScheduleDownloads)).await?;
                    download_wake = Box::pin(self.transfers.scheduling_changed(self.bandwidth.paused()));
                },
                Some(event) = event_receiver.recv() => session.on_timer(event).await?,
            }
        }
    }
}

pub(super) async fn forward_server_frames<R>(
    mut reader: R,
    sender: mpsc::Sender<Result<Frame, ProtocolError>>,
) where
    R: AsyncRead + Unpin,
{
    loop {
        let frame = read_frame(&mut reader).await;
        let terminal = frame.is_err();
        if sender.send(frame).await.is_err() || terminal {
            return;
        }
    }
}
