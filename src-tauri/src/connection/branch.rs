//! Bounded downstream distribution. Only the selected upstream/server may
//! supply searches; children never inject work into the network.
use super::protocol::{
    read_distributed_frame, write_raw_frame, DistributedFrame, ProtocolError,
    DISTRIBUTED_BRANCH_LEVEL_CODE, DISTRIBUTED_BRANCH_ROOT_CODE,
};
use super::{
    distributed::{RequestAdmission, RequestGuard},
    protocol::parse_distributed_search,
};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio::{net::TcpStream, sync::mpsc, time::timeout};

pub const STABLE_FOR: Duration = Duration::from_secs(60);
const MAX_CHILDREN: usize = 4;
const CHILD_QUEUE: usize = 64;

pub struct ChildCandidate {
    pub username: String,
    pub stream: TcpStream,
}

struct Child {
    sender: mpsc::Sender<Vec<u8>>,
    task: tauri::async_runtime::JoinHandle<()>,
}
impl Drop for Child {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub struct Branch {
    children: HashMap<String, Child>,
    topology: Option<(u32, String)>,
    stable_since: Instant,
    pub minimum_speed: Option<u32>,
    pub speed_ratio: Option<u32>,
    pub upload_speed: u32,
    pub capacity: usize,
    pub relayed: u64,
    guard: RequestGuard,
}

impl Branch {
    pub fn new() -> Self {
        Self {
            children: HashMap::new(),
            topology: None,
            stable_since: Instant::now(),
            minimum_speed: None,
            speed_ratio: None,
            upload_speed: 0,
            capacity: 0,
            relayed: 0,
            guard: RequestGuard::new(),
        }
    }
    pub fn reset(&mut self) {
        self.children.clear();
        self.topology = None;
        self.capacity = 0;
        self.stable_since = Instant::now();
    }
    pub fn topology(&mut self, level: u32, root: String) {
        if self.topology.is_none() {
            self.stable_since = Instant::now();
        }
        self.topology = Some((level, root.clone()));
        self.broadcast(encode(DISTRIBUTED_BRANCH_LEVEL_CODE, &level.to_le_bytes()));
        self.broadcast(root_frame(&root));
    }
    pub fn level(&mut self, level: u32) {
        if let Some((_, root)) = self.topology.clone() {
            self.topology(level, root);
        }
    }
    pub fn root(&mut self, root: String) {
        if let Some((level, _)) = self.topology {
            self.topology(level, root);
        }
    }
    pub fn refresh(&mut self, enabled: bool, reachable: bool) {
        self.children.retain(|_, child| !child.sender.is_closed());
        self.capacity = child_capacity(
            enabled,
            reachable,
            self.topology.is_some(),
            self.stable_since.elapsed(),
            self.upload_speed,
            self.minimum_speed,
            self.speed_ratio,
        );
        if self.children.len() > self.capacity {
            // Reset downstream rather than leave an overloaded partial branch.
            self.children.clear();
        }
    }
    pub fn count(&self) -> usize {
        self.children.len()
    }
    pub fn accepting(&self) -> bool {
        self.topology.is_some() && self.children.len() < self.capacity
    }

    pub fn add(&mut self, candidate: ChildCandidate, own: &str, parent: Option<&str>) {
        let Some((level, root)) = &self.topology else {
            return;
        };
        let key = candidate.username.to_ascii_lowercase();
        if !self.accepting()
            || key.is_empty()
            || key.len() > 100
            || key == own.to_ascii_lowercase()
            || key == root.to_ascii_lowercase()
            || parent.is_some_and(|parent| parent.eq_ignore_ascii_case(&key))
            || self.children.contains_key(&key)
        {
            return;
        }
        let (sender, receiver) = mpsc::channel(CHILD_QUEUE);
        let _ = sender.try_send(encode(DISTRIBUTED_BRANCH_LEVEL_CODE, &level.to_le_bytes()));
        let _ = sender.try_send(root_frame(root));
        let task = tauri::async_runtime::spawn(async move {
            let _ = run_child(candidate.stream, receiver).await;
        });
        self.children.insert(key, Child { sender, task });
    }

    pub fn relay(&mut self, frame: &DistributedFrame) {
        let Ok(search) = parse_distributed_search(frame) else {
            return;
        };
        if self
            .guard
            .admit(&search.username, search.token, Instant::now())
            != RequestAdmission::Allowed
        {
            return;
        }
        if !self.children.is_empty() {
            self.broadcast(encode(frame.code, &frame.payload));
            if !self.children.is_empty() {
                self.relayed = self.relayed.saturating_add(1);
            }
        }
    }
    fn broadcast(&mut self, bytes: Vec<u8>) {
        // Full queues disconnect that child; never stall the upstream actor or
        // silently lose searches while retaining a broken child connection.
        self.children
            .retain(|_, child| child.sender.try_send(bytes.clone()).is_ok());
    }
}

fn child_capacity(
    enabled: bool,
    reachable: bool,
    topology: bool,
    stable: Duration,
    speed: u32,
    minimum: Option<u32>,
    ratio: Option<u32>,
) -> usize {
    let (Some(minimum), Some(ratio)) = (minimum, ratio) else {
        return 0;
    };
    if !enabled || !reachable || !topology || stable < STABLE_FOR || speed < minimum || ratio == 0 {
        return 0;
    }
    // Soulseek's ratio is in hundreds of bytes/sec, as used by existing clients.
    ((speed / ratio / 100) as usize).min(MAX_CHILDREN)
}

pub fn encode(code: u8, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(payload.len() + 5);
    bytes.extend_from_slice(&((payload.len() + 1) as u32).to_le_bytes());
    bytes.push(code);
    bytes.extend_from_slice(payload);
    bytes
}
fn root_frame(root: &str) -> Vec<u8> {
    let mut payload = (root.len() as u32).to_le_bytes().to_vec();
    payload.extend_from_slice(root.as_bytes());
    encode(DISTRIBUTED_BRANCH_ROOT_CODE, &payload)
}

async fn run_child(
    stream: TcpStream,
    mut receiver: mpsc::Receiver<Vec<u8>>,
) -> Result<(), ProtocolError> {
    let (mut reader, mut writer) = stream.into_split();
    // Keep this read future alive across writes: read_exact is not cancellation safe.
    let input = async {
        loop {
            let frame = read_distributed_frame(&mut reader).await?;
            if !matches!(frame.code, 0 | 7) {
                return Ok::<(), ProtocolError>(());
            }
        }
    };
    tokio::pin!(input);
    loop {
        tokio::select! {
            result = &mut input => return result,
            bytes = receiver.recv() => {
                let Some(bytes) = bytes else { return Ok(()); };
                match timeout(Duration::from_secs(5), write_raw_frame(&mut writer, &bytes)).await {
                    Ok(result) => result?, Err(_) => return Ok(()),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::AsyncWriteExt, net::TcpListener};

    #[test]
    fn branch_requires_stability_reachability_and_server_speed_limits() {
        assert_eq!(
            child_capacity(true, true, true, STABLE_FOR, 500_000, Some(1000), Some(500)),
            4
        );
        assert_eq!(
            child_capacity(true, true, true, STABLE_FOR, 100_000, Some(1000), Some(500)),
            2
        );
        for (enabled, reachable, topology, stable, speed, minimum, ratio) in [
            (
                false,
                true,
                true,
                STABLE_FOR,
                500_000,
                Some(1000),
                Some(500),
            ),
            (
                true,
                false,
                true,
                STABLE_FOR,
                500_000,
                Some(1000),
                Some(500),
            ),
            (
                true,
                true,
                false,
                STABLE_FOR,
                500_000,
                Some(1000),
                Some(500),
            ),
            (
                true,
                true,
                true,
                Duration::ZERO,
                500_000,
                Some(1000),
                Some(500),
            ),
            (true, true, true, STABLE_FOR, 500, Some(1000), Some(500)),
            (true, true, true, STABLE_FOR, 500_000, None, Some(500)),
            (true, true, true, STABLE_FOR, 500_000, Some(1000), Some(0)),
        ] {
            assert_eq!(
                child_capacity(enabled, reachable, topology, stable, speed, minimum, ratio),
                0
            );
        }
    }

    #[tokio::test]
    async fn child_receives_topology_and_search_and_cannot_inject_searches() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut peer = TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        let mut branch = Branch::new();
        branch.topology(2, "root".into());
        branch.capacity = 1;
        branch.add(
            ChildCandidate {
                username: "child".into(),
                stream,
            },
            "self",
            Some("parent"),
        );
        let level = read_distributed_frame(&mut peer).await.unwrap();
        assert_eq!(level.payload, 2_u32.to_le_bytes());
        assert_eq!(
            read_distributed_frame(&mut peer).await.unwrap().code,
            DISTRIBUTED_BRANCH_ROOT_CODE
        );
        let mut payload = 49_u32.to_le_bytes().to_vec();
        payload.extend_from_slice(&6_u32.to_le_bytes());
        payload.extend_from_slice(b"finder");
        payload.extend_from_slice(&17_u32.to_le_bytes());
        payload.extend_from_slice(&5_u32.to_le_bytes());
        payload.extend_from_slice(b"music");
        branch.relay(&DistributedFrame {
            code: 3,
            payload: payload.clone(),
        });
        assert_eq!(
            read_distributed_frame(&mut peer).await.unwrap().payload,
            payload
        );
        branch.relay(&DistributedFrame { code: 3, payload });
        assert_eq!(branch.relayed, 1);
        peer.write_all(&encode(3, &[1, 2, 3])).await.unwrap();
        assert!(
            timeout(Duration::from_secs(1), read_distributed_frame(&mut peer))
                .await
                .unwrap()
                .is_err()
        );
        branch.reset();
        assert_eq!(branch.count(), 0);
        assert!(!branch.accepting());
    }

    #[tokio::test]
    async fn full_child_queue_is_removed_without_blocking() {
        let (sender, _receiver) = mpsc::channel(1);
        sender.try_send(vec![0]).unwrap();
        let mut branch = Branch::new();
        branch.children.insert(
            "slow".into(),
            Child {
                sender,
                task: tauri::async_runtime::spawn(std::future::pending()),
            },
        );
        branch.broadcast(vec![1]);
        assert_eq!(branch.count(), 0);
    }
}
