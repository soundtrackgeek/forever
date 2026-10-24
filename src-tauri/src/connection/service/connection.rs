use super::super::distributed::RequestAdmission;
use super::super::local_shares::SearchResponseOrigin;
use super::super::protocol::{
    accept_children_frame, branch_level_frame, branch_root_frame, connect_to_peer_frame,
    file_search_frame, get_peer_address_frame, have_no_parent_frame, wishlist_search_frame,
    write_raw_frame, DistributedSearch,
};
use super::super::search_governor::SearchLane;
use super::super::settings::ConnectionProfile;
use super::{
    hubs, retry_delay, server_label, timestamp_ms, ConnectionFailure, ConnectionManager,
    ConnectionSnapshot, ConnectionState, MAX_SEARCH_QUERY_BYTES, MAX_SEARCH_USERNAME_BYTES,
};
use std::sync::atomic::Ordering;
use std::time::Instant;
use tokio::io::AsyncWrite;
use zeroize::Zeroizing;

// Reconnect policy and shared search dispatch.

impl ConnectionManager {
    pub(super) async fn announce_no_distributed_parent<W>(
        &self,
        writer: &mut W,
        own_username: &str,
    ) -> Result<(), ConnectionFailure>
    where
        W: AsyncWrite + Unpin,
    {
        for frame in [
            have_no_parent_frame(true),
            branch_root_frame(own_username),
            branch_level_frame(0),
            accept_children_frame(false),
        ] {
            write_raw_frame(writer, &frame).await.map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The global-search network could not be initialized: {error}"),
                    "distributed_setup_failed",
                )
            })?;
        }
        Ok(())
    }

    pub(super) async fn announce_distributed_parent<W>(
        &self,
        writer: &mut W,
        branch_root: &str,
        branch_level: u32,
    ) -> Result<(), ConnectionFailure>
    where
        W: AsyncWrite + Unpin,
    {
        for frame in [
            have_no_parent_frame(false),
            branch_root_frame(branch_root),
            branch_level_frame(branch_level),
            accept_children_frame(false),
        ] {
            write_raw_frame(writer, &frame).await.map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The global-search parent could not be announced: {error}"),
                    "distributed_parent_failed",
                )
            })?;
        }
        Ok(())
    }

    pub(super) async fn answer_search_request<W>(
        &self,
        writer: &mut W,
        own_username: &str,
        request: DistributedSearch,
        origin: SearchResponseOrigin,
    ) -> Result<(), ConnectionFailure>
    where
        W: AsyncWrite + Unpin,
    {
        if request.username.is_empty()
            || request.username.len() > MAX_SEARCH_USERNAME_BYTES
            || request.query.is_empty()
            || request.query.len() > MAX_SEARCH_QUERY_BYTES
            || (origin == SearchResponseOrigin::Distributed
                && request.username.eq_ignore_ascii_case(own_username))
        {
            return Ok(());
        }
        if self.people.is_ignored(&request.username) {
            return Ok(());
        }
        if origin == SearchResponseOrigin::Distributed
            && self
                .distributed
                .admit_request(&request.username, request.token)
                != RequestAdmission::Allowed
        {
            return Ok(());
        }

        let connection_token = self.take_connection_token();
        let Some(ticket) = self.local_shares.queue_search_response(
            connection_token,
            &request.username,
            request.token,
            &request.query,
            origin,
        ) else {
            return Ok(());
        };
        if origin == SearchResponseOrigin::Distributed {
            self.distributed.record_match();
        }

        write_raw_frame(
            writer,
            &connect_to_peer_frame(connection_token, &ticket.username, "P"),
        )
        .await
        .map_err(|error| {
            ConnectionFailure::retryable(
                format!("The search-result peer request could not be sent: {error}"),
                "search_response_failed",
            )
        })?;
        write_raw_frame(writer, &get_peer_address_frame(&ticket.username))
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The search-result address request could not be sent: {error}"),
                    "search_response_failed",
                )
            })?;
        Ok(())
    }

    pub(super) async fn run_connection_loop(
        &self,
        profile: ConnectionProfile,
        password: Zeroizing<String>,
        generation: u64,
    ) {
        let mut attempt = 0;
        loop {
            if self.generation.load(Ordering::SeqCst) != generation {
                return;
            }

            attempt += 1;
            let state = if attempt == 1 {
                ConnectionState::Connecting
            } else {
                ConnectionState::Reconnecting
            };
            self.publish(ConnectionSnapshot {
                state,
                username: Some(profile.username.clone()),
                server: Some(server_label(&profile)),
                message: if attempt == 1 {
                    "Connecting to the Soulseek network…".to_owned()
                } else {
                    format!("Reconnect attempt {attempt}…")
                },
                attempt,
                connected_at_ms: None,
                retry_in_seconds: None,
                updated_at_ms: timestamp_ms(),
            });
            self.diagnostics.record(
                "info",
                if attempt == 1 {
                    "connect_started"
                } else {
                    "reconnect_started"
                },
                &format!("Connecting to {}.", server_label(&profile)),
            );

            let outcome = self
                .connect_once(&profile, password.as_str(), attempt)
                .await;
            if self.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            self.clear_command_sender();
            self.hubs()
                .disconnected(hubs::DisconnectReason::Interrupted);

            match outcome {
                Ok(()) => {
                    let failure = ConnectionFailure::retryable(
                        "The Soulseek server closed the connection.",
                        "socket_closed",
                    );
                    if !self.wait_to_retry(&profile, attempt, &failure).await {
                        return;
                    }
                }
                Err(failure) if failure.retryable => {
                    if !self.wait_to_retry(&profile, attempt, &failure).await {
                        return;
                    }
                }
                Err(failure) => {
                    self.diagnostics
                        .record("error", failure.event, &failure.message);
                    self.publish(ConnectionSnapshot {
                        state: ConnectionState::Error,
                        username: Some(profile.username.clone()),
                        server: Some(server_label(&profile)),
                        message: failure.message,
                        attempt,
                        connected_at_ms: None,
                        retry_in_seconds: None,
                        updated_at_ms: timestamp_ms(),
                    });
                    return;
                }
            }
        }
    }

    pub(super) async fn dispatch_search<W: AsyncWrite + Unpin>(
        &self,
        writer: &mut W,
    ) -> Result<(), ConnectionFailure> {
        let request = self
            .search_governor
            .take_next(Instant::now(), |lane| match lane {
                SearchLane::User => self
                    .search
                    .start_pending(false)
                    .or_else(|| self.wanted.start_pending(false)),
                SearchLane::Relay => self.search.start_pending(true),
                SearchLane::Radar | SearchLane::Wanted => {
                    let mut token = self.next_search_token.fetch_add(1, Ordering::SeqCst);
                    if token == 0 {
                        token = self.next_search_token.fetch_add(1, Ordering::SeqCst);
                    }
                    if lane == SearchLane::Radar {
                        self.radar.start_next(token)
                    } else {
                        self.wanted
                            .start_pending(true)
                            .or_else(|| self.wanted.start_due(token).map(|query| (token, query)))
                    }
                }
            });
        if let Some((lane, (token, query))) = request {
            let frame = if lane == SearchLane::Wanted {
                wishlist_search_frame(token, &query)
            } else {
                file_search_frame(token, &query)
            };
            if let Err(error) = write_raw_frame(writer, &frame).await {
                let message = format!("The scheduled search could not be sent: {error}");
                if lane == SearchLane::Radar {
                    self.radar.fail_active(&message);
                }
                return Err(ConnectionFailure::retryable(message, "search_send_failed"));
            }
            // A slow socket write must not make the next send immediately due.
            self.search_governor.sent(lane, Instant::now());
            self.wanted.publish();
        }
        Ok(())
    }

    pub(super) async fn wait_to_retry(
        &self,
        profile: &ConnectionProfile,
        attempt: u32,
        failure: &ConnectionFailure,
    ) -> bool {
        let delay = retry_delay(attempt);
        self.diagnostics
            .record("warn", failure.event, &failure.message);
        self.publish(ConnectionSnapshot {
            state: ConnectionState::Reconnecting,
            username: Some(profile.username.clone()),
            server: Some(server_label(profile)),
            message: failure.message.clone(),
            attempt,
            connected_at_ms: None,
            retry_in_seconds: Some(delay.as_secs()),
            updated_at_ms: timestamp_ms(),
        });
        tokio::time::sleep(delay).await;
        true
    }
}
