use super::super::local_shares::SearchResponseOrigin;
use super::super::protocol::{
    accept_children_frame, branch_level_frame, branch_root_frame, parse_distributed_branch_level,
    parse_distributed_branch_root, parse_distributed_search, peer_init_frame,
    read_distributed_frame, set_wait_port_frame, write_raw_frame, DistributedFrame,
    ParentCandidate, ProtocolError, DISTRIBUTED_BRANCH_LEVEL_CODE, DISTRIBUTED_BRANCH_ROOT_CODE,
    DISTRIBUTED_EMBEDDED_CODE, DISTRIBUTED_SEARCH_CODE,
};
use super::super::reachability::DirectStatus;
use super::peers::peer_timeout_error;
use super::session::Session;
use super::{
    AbortOnDrop, ConnectionFailure, DISTRIBUTED_PARENT_IDLE_TIMEOUT, PEER_CONNECT_TIMEOUT,
};
use std::collections::HashMap;
use tokio::io::AsyncWrite;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;

// Distributed parent selection, branch state, and network announcements.

pub(super) struct DistributedCandidateTask {
    pub(super) username: String,
    pub(super) branch_level: Option<u32>,
    pub(super) branch_root: Option<String>,
    pub(super) _task: AbortOnDrop,
}

pub(super) enum DistributedPeerEvent {
    Frame { id: u64, frame: DistributedFrame },
    Closed { id: u64 },
}

pub(super) struct DistributedCoordinator {
    next_id: u64,
    pub(super) candidates: HashMap<u64, DistributedCandidateTask>,
    active_parent: Option<u64>,
    server_is_parent: bool,
}

impl DistributedCoordinator {
    pub(super) fn new() -> Self {
        Self {
            next_id: 1,
            candidates: HashMap::new(),
            active_parent: None,
            server_is_parent: false,
        }
    }

    pub(super) fn start_candidates(
        &mut self,
        parents: Vec<ParentCandidate>,
        own_username: &str,
        event_sender: &mpsc::Sender<DistributedPeerEvent>,
    ) {
        if self.active_parent.is_some() || self.server_is_parent || !self.candidates.is_empty() {
            return;
        }
        self.candidates.clear();
        let mut usernames = std::collections::HashSet::new();
        for parent in parents {
            if parent.username.eq_ignore_ascii_case(own_username)
                || !usernames.insert(parent.username.to_ascii_lowercase())
            {
                continue;
            }
            let id = self.next_id;
            self.next_id = self.next_id.wrapping_add(1).max(1);
            let task = spawn_distributed_parent_candidate(
                id,
                parent.clone(),
                own_username.to_owned(),
                event_sender.clone(),
            );
            self.candidates.insert(
                id,
                DistributedCandidateTask {
                    username: parent.username.clone(),
                    branch_level: None,
                    branch_root: None,
                    _task: task,
                },
            );
        }
    }

    pub(super) fn update_branch_level(&mut self, id: u64, level: u32) -> Option<u32> {
        let own_level = level
            .checked_add(1)
            .filter(|level| *level <= i32::MAX as u32)?;
        let candidate = self.candidates.get_mut(&id)?;
        candidate.branch_level = Some(level);
        if level == 0 {
            candidate.branch_root = Some(candidate.username.clone());
        }
        (self.active_parent == Some(id)).then_some(own_level)
    }

    pub(super) fn update_branch_root(&mut self, id: u64, root: String) -> Option<String> {
        let candidate = self.candidates.get_mut(&id)?;
        candidate.branch_root = Some(root.clone());
        (self.active_parent == Some(id)).then_some(root)
    }

    pub(super) fn adopt(&mut self, id: u64) -> Option<(u32, String)> {
        if self.active_parent.is_some() || self.server_is_parent {
            return None;
        }
        let candidate = self.candidates.get(&id)?;
        let level = candidate
            .branch_level?
            .checked_add(1)
            .filter(|level| *level <= i32::MAX as u32)?;
        let root = candidate.branch_root.clone()?;
        let candidate = self.candidates.remove(&id)?;
        self.candidates.clear();
        self.candidates.insert(id, candidate);
        self.active_parent = Some(id);
        Some((level, root))
    }

    pub(super) fn accepts_search_from(&self, id: u64) -> bool {
        self.active_parent == Some(id)
    }

    pub(super) fn parent_username(&self) -> Option<&str> {
        self.active_parent
            .and_then(|id| self.candidates.get(&id))
            .map(|parent| parent.username.as_str())
    }

    pub(super) fn close(&mut self, id: u64) -> bool {
        self.candidates.remove(&id);
        if self.active_parent == Some(id) {
            self.active_parent = None;
            return true;
        }
        false
    }

    pub(super) fn become_branch_root(&mut self) -> bool {
        let changed = !self.server_is_parent;
        self.candidates.clear();
        self.active_parent = None;
        self.server_is_parent = true;
        changed
    }

    pub(super) fn reset(&mut self) {
        self.candidates.clear();
        self.active_parent = None;
        self.server_is_parent = false;
    }
}

pub(super) fn spawn_distributed_parent_candidate(
    id: u64,
    parent: ParentCandidate,
    own_username: String,
    event_sender: mpsc::Sender<DistributedPeerEvent>,
) -> AbortOnDrop {
    AbortOnDrop(tauri::async_runtime::spawn(async move {
        let _ = run_distributed_parent_candidate(id, &parent, &own_username, event_sender.clone())
            .await;
        let _ = event_sender.send(DistributedPeerEvent::Closed { id }).await;
    }))
}

async fn run_distributed_parent_candidate(
    id: u64,
    parent: &ParentCandidate,
    own_username: &str,
    event_sender: mpsc::Sender<DistributedPeerEvent>,
) -> Result<(), ProtocolError> {
    let mut stream = timeout(
        PEER_CONNECT_TIMEOUT,
        TcpStream::connect((parent.address, parent.port)),
    )
    .await
    .map_err(|_| peer_timeout_error())??;
    let _ = stream.set_nodelay(true);
    write_raw_frame(&mut stream, &peer_init_frame(own_username, "D")).await?;

    loop {
        let frame = timeout(
            DISTRIBUTED_PARENT_IDLE_TIMEOUT,
            read_distributed_frame(&mut stream),
        )
        .await
        .map_err(|_| peer_timeout_error())??;
        if event_sender
            .send(DistributedPeerEvent::Frame { id, frame })
            .await
            .is_err()
        {
            return Ok(());
        }
    }
}

impl<W: AsyncWrite + Unpin> Session<'_, W> {
    pub(super) async fn on_distributed_event(
        &mut self,
        event: DistributedPeerEvent,
    ) -> Result<(), ConnectionFailure> {
        match event {
            DistributedPeerEvent::Frame { id, frame } => match frame.code {
                DISTRIBUTED_BRANCH_LEVEL_CODE => {
                    if let Ok(level) = parse_distributed_branch_level(&frame) {
                        if let Some(own_level) = self.coordinator.update_branch_level(id, level) {
                            write_raw_frame(&mut self.writer, &branch_level_frame(own_level))
                                .await
                                .map_err(|error| {
                                    ConnectionFailure::retryable(
                                        format!("The global-search branch update failed: {error}"),
                                        "distributed_parent_failed",
                                    )
                                })?;
                            self.manager.distributed.connected(own_level);
                            self.branch.level(own_level);
                        }
                    }
                }
                DISTRIBUTED_BRANCH_ROOT_CODE => {
                    if let Ok(root) = parse_distributed_branch_root(&frame) {
                        if let Some(own_root) = self.coordinator.update_branch_root(id, root) {
                            write_raw_frame(&mut self.writer, &branch_root_frame(&own_root))
                                .await
                                .map_err(|error| {
                                    ConnectionFailure::retryable(
                                        format!("The global-search branch update failed: {error}"),
                                        "distributed_parent_failed",
                                    )
                                })?;
                            self.branch.root(own_root);
                        }
                    }
                }
                DISTRIBUTED_SEARCH_CODE | DISTRIBUTED_EMBEDDED_CODE => {
                    // Older peers wrap searches in distributed code 93.
                    // Relay the inner code-3 message, never the wrapper.
                    let frame = if frame.code == DISTRIBUTED_EMBEDDED_CODE {
                        if frame.payload.first() != Some(&DISTRIBUTED_SEARCH_CODE) {
                            return Ok(());
                        }
                        DistributedFrame {
                            code: DISTRIBUTED_SEARCH_CODE,
                            payload: frame.payload[1..].to_vec(),
                        }
                    } else {
                        frame
                    };
                    if let Ok(request) = parse_distributed_search(&frame) {
                        if !self.coordinator.accepts_search_from(id) {
                            if let Some((branch_level, branch_root)) = self.coordinator.adopt(id) {
                                self.manager
                                    .announce_distributed_parent(
                                        &mut self.writer,
                                        &branch_root,
                                        branch_level,
                                    )
                                    .await?;
                                self.manager.distributed.connected(branch_level);
                                self.branch.topology(branch_level, branch_root);
                                self.accepting_children = false;
                                self.manager.diagnostics.record(
                                    "info",
                                    "distributed_connected",
                                    "Connected to the global-search network.",
                                );
                            }
                        }
                        if self.coordinator.accepts_search_from(id) {
                            self.branch.relay(&frame);
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
                }
                _ => {}
            },
            DistributedPeerEvent::Closed { id } => {
                if self.coordinator.close(id) {
                    self.branch.reset();
                    self.accepting_children = false;
                    self.manager
                        .announce_no_distributed_parent(&mut self.writer, &self.profile.username)
                        .await?;
                    self.manager.distributed.rediscovering();
                    self.manager.diagnostics.record(
                        "warn",
                        "distributed_parent_lost",
                        "The global-search relay disconnected; finding another.",
                    );
                }
            }
        }

        Ok(())
    }

    pub(super) async fn maintain_network(&mut self) -> Result<(), ConnectionFailure> {
        self.manager
            .reachability
            .expire_evidence(self.reachability_id);
        let network = self.manager.reachability.snapshot();
        let port = network.advertised_port.unwrap_or(self.listen_port);
        if port != self.advertised_port {
            write_raw_frame(&mut self.writer, &set_wait_port_frame(port))
                .await
                .map_err(|error| {
                    ConnectionFailure::retryable(error.to_string(), "listen_announce_failed")
                })?;
            self.advertised_port = port;
        }
        self.branch.refresh(
            self.profile.allow_distributed_children,
            network.status == DirectStatus::Reachable,
        );
        if self.branch.accepting() != self.accepting_children {
            self.accepting_children = self.branch.accepting();
            write_raw_frame(
                &mut self.writer,
                &accept_children_frame(self.accepting_children),
            )
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(error.to_string(), "distributed_parent_failed")
            })?;
        }
        self.manager.distributed.branch_status(
            self.accepting_children,
            self.branch.count(),
            self.branch.capacity,
            self.branch.relayed,
        );

        Ok(())
    }
}
