use super::super::local_shares::SearchResponseOrigin;
use super::super::protocol::{
    parse_cant_connect_token, parse_connect_to_peer, parse_embedded_distributed_search,
    parse_peer_address, parse_possible_parents, parse_server_search_request, DistributedFrame,
    DistributedSearch, Frame, CANT_CONNECT_TO_PEER_CODE, CONNECT_TO_PEER_CODE,
    DISTRIBUTED_SEARCH_CODE, EMBEDDED_MESSAGE_CODE, FILE_SEARCH_CODE, GET_PEER_ADDRESS_CODE,
    PARENT_MIN_SPEED_CODE, PARENT_SPEED_RATIO_CODE, POSSIBLE_PARENTS_CODE, RELOGGED_CODE,
    RESET_DISTRIBUTED_CODE,
};
use super::peers::{
    spawn_indirect_child, spawn_indirect_peer, spawn_outbound_download_peer,
    spawn_outbound_folder_peer, spawn_outbound_profile_peer, spawn_outbound_search_response_peer,
    spawn_outbound_shares_peer, spawn_outbound_upload_control_peer,
    spawn_outbound_upload_file_peer,
};
use super::session::Session;
use super::{ConnectionCommand, ConnectionFailure};
use tokio::io::AsyncWrite;

// Dispatch of session-level server messages. Hub frames use the registry.

impl<W: AsyncWrite + Unpin> Session<'_, W> {
    pub(super) async fn on_server_frame(&mut self, frame: Frame) -> Result<(), ConnectionFailure> {
        if frame.code == RELOGGED_CODE {
            return Err(ConnectionFailure::fatal(
                "This account signed in from another Soulseek client.",
                "relogged",
            ));
        }
        if self.dispatch_hub_frame(&frame).await? {
            return Ok(());
        }
        match frame.code {
            FILE_SEARCH_CODE => {
                if let Ok((username, search_token, query)) = parse_server_search_request(&frame) {
                    self.manager
                        .answer_search_request(
                            &mut self.writer,
                            &self.profile.username,
                            DistributedSearch {
                                username,
                                token: search_token,
                                query,
                            },
                            SearchResponseOrigin::Server,
                        )
                        .await?;
                }
            }
            PARENT_MIN_SPEED_CODE | PARENT_SPEED_RATIO_CODE => {
                if let Ok(bytes) = <[u8; 4]>::try_from(frame.payload.as_slice()) {
                    let value = u32::from_le_bytes(bytes);
                    if frame.code == PARENT_MIN_SPEED_CODE {
                        self.branch.minimum_speed = Some(value);
                    } else {
                        self.branch.speed_ratio = Some(value);
                    }
                }
            }
            POSSIBLE_PARENTS_CODE => {
                if let Ok(parents) = parse_possible_parents(&frame) {
                    self.coordinator.start_candidates(
                        parents,
                        &self.profile.username,
                        &self.distributed_event_sender,
                    );
                }
            }
            EMBEDDED_MESSAGE_CODE => {
                if let Ok(request) = parse_embedded_distributed_search(&frame) {
                    if self.coordinator.become_branch_root() {
                        self.branch.reset();
                        self.branch.topology(0, self.profile.username.clone());
                        self.manager
                            .announce_no_distributed_parent(
                                &mut self.writer,
                                &self.profile.username,
                            )
                            .await?;
                        self.accepting_children = false;
                        self.manager.distributed.branch_root();
                        self.manager.diagnostics.record(
                            "info",
                            "distributed_branch_root",
                            "Global search connected in branch-root mode.",
                        );
                    }
                    self.branch.relay(&DistributedFrame {
                        code: DISTRIBUTED_SEARCH_CODE,
                        payload: frame.payload[1..].to_vec(),
                    });
                    self.manager
                        .answer_search_request(
                            &mut self.writer,
                            &self.profile.username,
                            request,
                            SearchResponseOrigin::Distributed,
                        )
                        .await?;
                }
            }
            RESET_DISTRIBUTED_CODE => {
                self.coordinator.reset();
                self.branch.reset();
                self.accepting_children = false;
                self.manager
                    .announce_no_distributed_parent(&mut self.writer, &self.profile.username)
                    .await?;
                self.manager.distributed.rediscovering();
                self.manager.diagnostics.record(
                    "warn",
                    "distributed_reset",
                    "The server reset global search; finding a new relay.",
                );
            }
            CONNECT_TO_PEER_CODE => {
                if let Ok(request) = parse_connect_to_peer(&frame) {
                    if request.connection_type == "D" {
                        if self.branch.accepting() {
                            spawn_indirect_child(
                                request,
                                self.child_sender.clone(),
                                self.peer_limit.clone(),
                            );
                        }
                    } else {
                        spawn_indirect_peer(
                            request,
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    }
                }
            }
            GET_PEER_ADDRESS_CODE => {
                if let Ok(address) = parse_peer_address(&frame) {
                    if let Some(ticket) = self
                        .manager
                        .uploads
                        .requesting_file_for_username(&address.username)
                    {
                        spawn_outbound_upload_file_peer(
                            address,
                            ticket,
                            self.profile.username.clone(),
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    } else if let Some(ticket) = self
                        .manager
                        .uploads
                        .requesting_control_for_username(&address.username)
                    {
                        spawn_outbound_upload_control_peer(
                            address,
                            ticket,
                            self.profile.username.clone(),
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    } else if let Some(ticket) = self
                        .manager
                        .local_shares
                        .requesting_search_for_username(&address.username)
                    {
                        spawn_outbound_search_response_peer(
                            address,
                            ticket,
                            self.profile.username.clone(),
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    } else if let Some(ticket) = self
                        .manager
                        .people
                        .requesting_for_username(&address.username)
                    {
                        spawn_outbound_profile_peer(
                            address,
                            ticket,
                            self.profile.username.clone(),
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    } else if let Some(ticket) = self
                        .manager
                        .folders
                        .requesting_for_username(&address.username)
                    {
                        spawn_outbound_folder_peer(
                            address,
                            ticket,
                            self.profile.username.clone(),
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    } else if let Some(ticket) = self
                        .manager
                        .shares
                        .requesting_for_username(&address.username)
                    {
                        spawn_outbound_shares_peer(
                            address,
                            ticket,
                            self.profile.username.clone(),
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    } else if let Some(ticket) = self
                        .manager
                        .transfers
                        .requesting_for_username(&address.username)
                    {
                        spawn_outbound_download_peer(
                            address,
                            ticket,
                            self.profile.username.clone(),
                            self.manager
                                .peer_services(&self.profile.username, &self.command_sender),
                            self.peer_limit.clone(),
                        );
                    }
                }
            }
            CANT_CONNECT_TO_PEER_CODE => {
                if let Ok(token) = parse_cant_connect_token(&frame) {
                    if self.manager.transfers.retry_connection(
                        token,
                        "The source could not establish a peer connection.".to_owned(),
                    ) {
                        let _ = self
                            .command_sender
                            .send(ConnectionCommand::ScheduleDownloads);
                    }
                    self.manager.folders.fail_connection(
                        token,
                        "The source could not establish a peer connection.".to_owned(),
                    );
                    self.manager.shares.fail_connection(
                        token,
                        "The source could not establish a peer connection.".to_owned(),
                    );
                    self.manager.local_shares.fail_search(token);
                    self.manager.people.fail_profile(
                        token,
                        "The user could not establish a profile connection.".to_owned(),
                    );
                    if self.manager.uploads.fail_connection(
                        token,
                        "The downloader could not establish a peer connection.".to_owned(),
                    ) {
                        let _ = self.command_sender.send(ConnectionCommand::ScheduleUploads);
                    }
                }
            }

            _ => {}
        }

        Ok(())
    }
}
