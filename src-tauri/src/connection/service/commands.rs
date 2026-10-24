use super::super::protocol::{
    cant_connect_to_peer_frame, connect_to_peer_frame, get_peer_address_frame, join_room_frame,
    leave_room_frame, message_user_frame, room_list_frame, say_chatroom_frame,
    send_upload_speed_frame, shared_counts_frame, unwatch_user_frame, user_interests_frame,
    user_stats_frame, watch_user_frame, write_raw_frame,
};
use super::peers::{spawn_transfer_request_timeout, spawn_upload_request_timeout};
use super::session::Session;
use super::{ConnectionCommand, ConnectionFailure};
use tokio::io::AsyncWrite;

// Serialized command writes; this module shares the session writer.

impl<W: AsyncWrite + Unpin> Session<'_, W> {
    pub(super) async fn on_command(
        &mut self,
        command: Option<ConnectionCommand>,
    ) -> Result<(), ConnectionFailure> {
        match command {
            // Producers queue in their bounded hubs. The shared tick is
            // the only place that admits and sends network searches.
            Some(ConnectionCommand::SearchesChanged) => {}
            Some(ConnectionCommand::SendPrivateMessage {
                id,
                username,
                message,
            }) => {
                let frame = match message_user_frame(&username, &message) {
                    Ok(frame) => frame,
                    Err(error) => {
                        let detail = format!("The private message is invalid: {error}");
                        let _ = self.manager.messages.mark_failed(&id, &detail);
                        return Err(ConnectionFailure::fatal(detail, "message_invalid"));
                    }
                };
                if let Err(error) = write_raw_frame(&mut self.writer, &frame).await {
                    let detail = format!("The private message could not be sent: {error}");
                    let _ = self.manager.messages.mark_failed(&id, &detail);
                    return Err(ConnectionFailure::retryable(detail, "message_send_failed"));
                }
                self.manager.messages.mark_sent(&id).map_err(|error| {
                    ConnectionFailure::retryable(
                        format!("The sent private message could not be saved: {error}"),
                        "message_store_failed",
                    )
                })?;
            }
            Some(ConnectionCommand::RefreshRooms) => {
                write_raw_frame(&mut self.writer, &room_list_frame())
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The public room directory could not be refreshed: {error}"),
                            "room_list_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::JoinRoom { room }) => {
                write_raw_frame(&mut self.writer, &join_room_frame(&room))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The public room could not be joined: {error}"),
                            "room_join_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::LeaveRoom { room }) => {
                write_raw_frame(&mut self.writer, &leave_room_frame(&room))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The public room could not be left: {error}"),
                            "room_leave_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::SendRoomMessage { room, message }) => {
                let frame = say_chatroom_frame(&room, &message).map_err(|error| {
                    ConnectionFailure::fatal(
                        format!("The room message is invalid: {error}"),
                        "room_message_invalid",
                    )
                })?;
                write_raw_frame(&mut self.writer, &frame)
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The room message could not be sent: {error}"),
                            "room_message_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::InspectFolder { ticket }) => {
                write_raw_frame(
                    &mut self.writer,
                    &connect_to_peer_frame(ticket.connection_token, &ticket.username, "P"),
                )
                .await
                .map_err(|error| {
                    ConnectionFailure::retryable(
                        format!("The folder peer request could not be sent: {error}"),
                        "folder_request_failed",
                    )
                })?;
                write_raw_frame(&mut self.writer, &get_peer_address_frame(&ticket.username))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The folder source address request could not be sent: {error}"),
                            "folder_address_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::BrowseShares { ticket }) => {
                write_raw_frame(
                    &mut self.writer,
                    &connect_to_peer_frame(ticket.connection_token, &ticket.username, "P"),
                )
                .await
                .map_err(|error| {
                    ConnectionFailure::retryable(
                        format!("The share-list peer request could not be sent: {error}"),
                        "shares_request_failed",
                    )
                })?;
                write_raw_frame(&mut self.writer, &get_peer_address_frame(&ticket.username))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!(
                                "The share-list source address request could not be sent: {error}"
                            ),
                            "shares_address_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::RequestProfile { ticket }) => {
                if self.manager.people.mark_watched(&ticket.username) {
                    write_raw_frame(&mut self.writer, &watch_user_frame(&ticket.username))
                        .await
                        .map_err(|error| {
                            ConnectionFailure::retryable(
                                format!("The user presence request could not be sent: {error}"),
                                "people_watch_failed",
                            )
                        })?;
                }
                for frame in [
                    user_stats_frame(&ticket.username),
                    user_interests_frame(&ticket.username),
                    connect_to_peer_frame(ticket.connection_token, &ticket.username, "P"),
                    get_peer_address_frame(&ticket.username),
                ] {
                    write_raw_frame(&mut self.writer, &frame)
                        .await
                        .map_err(|error| {
                            ConnectionFailure::retryable(
                                format!("The user profile request could not be sent: {error}"),
                                "people_request_failed",
                            )
                        })?;
                }
            }
            Some(ConnectionCommand::WatchPerson { username }) => {
                if self.manager.people.mark_watched(&username) {
                    write_raw_frame(&mut self.writer, &watch_user_frame(&username))
                        .await
                        .map_err(|error| {
                            ConnectionFailure::retryable(
                                format!("The user presence request could not be sent: {error}"),
                                "people_watch_failed",
                            )
                        })?;
                }
            }
            Some(ConnectionCommand::UnwatchPerson { username }) => {
                self.manager.people.mark_unwatched(&username);
                write_raw_frame(&mut self.writer, &unwatch_user_frame(&username))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The user presence update could not be sent: {error}"),
                            "people_watch_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::PeerConnectionFailed { token, username }) => {
                write_raw_frame(
                    &mut self.writer,
                    &cant_connect_to_peer_frame(token, &username),
                )
                .await
                .map_err(|error| {
                    ConnectionFailure::retryable(
                        format!("The peer connection response could not be sent: {error}"),
                        "peer_response_failed",
                    )
                })?;
            }
            Some(ConnectionCommand::ScheduleDownloads) => loop {
                let token = self.manager.take_connection_token();
                let Some(ticket) = self.manager.transfers.activate_next(token) else {
                    break;
                };
                write_raw_frame(
                    &mut self.writer,
                    &connect_to_peer_frame(ticket.connection_token, &ticket.username, "P"),
                )
                .await
                .map_err(|error| {
                    ConnectionFailure::retryable(
                        format!("The download peer request could not be sent: {error}"),
                        "download_request_failed",
                    )
                })?;
                write_raw_frame(&mut self.writer, &get_peer_address_frame(&ticket.username))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The source address request could not be sent: {error}"),
                            "download_address_failed",
                        )
                    })?;
                spawn_transfer_request_timeout(
                    ticket,
                    self.manager.transfers.clone(),
                    self.command_sender.clone(),
                );
            },
            Some(ConnectionCommand::ReportUploadSpeed { bytes_per_second }) => {
                write_raw_frame(&mut self.writer, &send_upload_speed_frame(bytes_per_second))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The upload speed report could not be sent: {error}"),
                            "upload_speed_report_failed",
                        )
                    })?;
            }
            Some(ConnectionCommand::ScheduleUploads) => {
                // Wait for startup indexing before validating restored requests.
                while !self.manager.local_shares.is_scanning() {
                    let token = self.manager.take_connection_token();
                    let Some(ticket) = self
                        .manager
                        .uploads
                        .activate_next(token, self.manager.local_shares.upload_slots())
                    else {
                        break;
                    };
                    let file = self
                        .manager
                        .local_shares
                        .resolve_file(&ticket.remote_filename);
                    if self.manager.people.is_blocked(&ticket.username)
                        || file
                            .as_ref()
                            .is_none_or(|f| f.size_bytes != ticket.size_bytes)
                    {
                        self.manager.uploads.fail_attempt(
                            &ticket.id,
                            ticket.transfer_token,
                            "File is no longer shared or this user is blocked.".into(),
                        );
                        continue;
                    }
                    write_raw_frame(
                        &mut self.writer,
                        &connect_to_peer_frame(ticket.connection_token, &ticket.username, "P"),
                    )
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The upload peer request could not be sent: {error}"),
                            "upload_request_failed",
                        )
                    })?;
                    write_raw_frame(&mut self.writer, &get_peer_address_frame(&ticket.username))
                        .await
                        .map_err(|error| {
                            ConnectionFailure::retryable(
                                format!(
                                    "The downloader address request could not be sent: {error}"
                                ),
                                "upload_address_failed",
                            )
                        })?;
                    spawn_upload_request_timeout(
                        ticket,
                        self.manager.uploads.clone(),
                        self.command_sender.clone(),
                    );
                }
            }
            Some(ConnectionCommand::OpenUploadFile { id }) => {
                let connection_token = self.manager.take_connection_token();
                if let Some(ticket) = self
                    .manager
                    .uploads
                    .prepare_file_connection(&id, connection_token)
                {
                    write_raw_frame(
                        &mut self.writer,
                        &connect_to_peer_frame(ticket.connection_token, &ticket.username, "F"),
                    )
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The upload file connection could not be sent: {error}"),
                            "upload_file_request_failed",
                        )
                    })?;
                    write_raw_frame(&mut self.writer, &get_peer_address_frame(&ticket.username))
                        .await
                        .map_err(|error| {
                            ConnectionFailure::retryable(
                        format!("The downloader file address request could not be sent: {error}"),
                        "upload_file_address_failed",
                    )
                        })?;
                }
            }
            Some(ConnectionCommand::RefreshSharedCounts) => {
                let (directories, files) = self.manager.local_shares.counts();
                write_raw_frame(&mut self.writer, &shared_counts_frame(directories, files))
                    .await
                    .map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("Updated shared counts could not be sent: {error}"),
                            "shared_counts_failed",
                        )
                    })?;
            }
            None => {
                return Err(ConnectionFailure::retryable(
                    "The Soulseek command channel closed.",
                    "command_channel_closed",
                ));
            }
        }

        Ok(())
    }
}
