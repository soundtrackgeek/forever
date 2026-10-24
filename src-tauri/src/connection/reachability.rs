//! Session-scoped evidence and leased router mappings. A mapping is not proof
//! that the WAN can reach us (double NAT and host firewalls are common).
use super::{diagnostics::Diagnostics, settings::ConnectionProfile};
use crab_nat::{InternetProtocol, PortMapping, PortMappingOptions, PortMappingType, TimeoutConfig};
use igd_next::{
    aio::{
        tokio::{search_gateway, Tokio},
        Gateway,
    },
    PortMappingProtocol, SearchOptions,
};
use serde::Serialize;
use std::{
    future::Future,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    num::NonZeroU16,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex as AsyncMutex},
    time::{timeout, Instant},
};

const EVENT: &str = "forever://reachability-status";
const LEASE_SECONDS: u32 = 1800;
const ROUTER_TIMEOUT: Duration = Duration::from_secs(4);
const EVIDENCE_LIFETIME: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectStatus {
    Unknown,
    Reachable,
    Firewalled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReachabilitySnapshot {
    pub status: DirectStatus,
    pub message: String,
    pub listen_port: Option<u16>,
    pub advertised_port: Option<u16>,
    pub mapping: String,
    pub mapping_message: String,
    pub checking: bool,
    pub incoming_connections: u64,
}

impl Default for ReachabilitySnapshot {
    fn default() -> Self {
        Self {
            status: DirectStatus::Unknown,
            message: "Connect to Soulseek to check direct connections.".into(),
            listen_port: None,
            advertised_port: None,
            mapping: "inactive".into(),
            mapping_message: "No active listening port.".into(),
            checking: false,
            incoming_connections: 0,
        }
    }
}

struct Evidence {
    session: u64,
    snapshot: ReachabilitySnapshot,
    local_ip: Option<IpAddr>,
    last_incoming: Option<Instant>,
    last_test: Option<Instant>,
}

impl Evidence {
    fn update(&mut self, session: u64, update: impl FnOnce(&mut Self)) -> bool {
        if self.session != session || self.snapshot.listen_port.is_none() {
            return false;
        }
        update(self);
        true
    }

    fn finish_test(
        &mut self,
        session: u64,
        port: u16,
        started: Instant,
        closed: bool,
        detail: String,
    ) {
        self.update(session, |state| {
            state.snapshot.checking = false;
            // Mapping renewal may have changed the public port while the test ran.
            if state.snapshot.advertised_port != Some(port) {
                return;
            }
            if state.last_incoming.is_some_and(|when| when >= started) {
                state.snapshot.status = DirectStatus::Reachable;
                state.snapshot.message =
                    "An outside connection reached this listening port.".into();
            } else {
                state.snapshot.status = if closed {
                    DirectStatus::Firewalled
                } else {
                    DirectStatus::Unknown
                };
                state.snapshot.message = detail;
                state.last_incoming = None;
            }
        });
    }
}

#[derive(Clone)]
pub struct ReachabilityHub {
    app: AppHandle,
    inner: Arc<Mutex<Evidence>>,
    // Hold through deletion: an old session must never delete a newer mapping.
    mapping_lock: Arc<AsyncMutex<()>>,
    workers: Arc<Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>>,
}

pub struct ReachabilitySession {
    pub id: u64,
    _stop: oneshot::Sender<()>,
}

impl ReachabilityHub {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Arc::new(Mutex::new(Evidence {
                session: 0,
                snapshot: ReachabilitySnapshot::default(),
                local_ip: None,
                last_incoming: None,
                last_test: None,
            })),
            mapping_lock: Arc::new(AsyncMutex::new(())),
            workers: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn snapshot(&self) -> ReachabilitySnapshot {
        self.inner.lock().unwrap().snapshot.clone()
    }

    fn update(&self, session: u64, update: impl FnOnce(&mut Evidence)) {
        let mut state = self.inner.lock().unwrap();
        let before = state.snapshot.clone();
        if state.update(session, update) && state.snapshot != before {
            let _ = self.app.emit(EVENT, state.snapshot.clone());
        }
    }

    pub fn offline(&self) {
        let mut state = self.inner.lock().unwrap();
        state.session += 1;
        state.snapshot = ReachabilitySnapshot::default();
        state.last_incoming = None;
        let _ = self.app.emit(EVENT, state.snapshot.clone());
    }

    pub fn begin(
        &self,
        profile: &ConnectionProfile,
        port: u16,
        local_ip: IpAddr,
        diagnostics: Diagnostics,
    ) -> ReachabilitySession {
        let session = {
            let mut state = self.inner.lock().unwrap();
            state.session += 1;
            state.local_ip = Some(local_ip);
            state.last_incoming = None;
            state.last_test = None;
            state.snapshot = ReachabilitySnapshot {
                listen_port: Some(port), advertised_port: Some(port),
                message: "Waiting for an outside connection; router mapping alone does not prove reachability.".into(),
                mapping: if profile.automatic_port_mapping { "discovering" } else { "disabled" }.into(),
                mapping_message: if port != profile.listen_port {
                    format!("Port {} was unavailable; using TCP {port}. Forward this actual port if configuring your router manually.", profile.listen_port)
                } else { format!("Listening on TCP {port}.") },
                ..ReachabilitySnapshot::default()
            };
            let _ = self.app.emit(EVENT, state.snapshot.clone());
            state.session
        };
        let (stop, receiver) = oneshot::channel();
        if profile.automatic_port_mapping {
            let hub = self.clone();
            let worker = tauri::async_runtime::spawn(async move {
                hub.mapping_worker(session, local_ip, port, receiver, diagnostics)
                    .await;
            });
            let mut workers = self.workers.lock().unwrap();
            workers.retain(|worker| !worker.inner().is_finished());
            workers.push(worker);
        }
        ReachabilitySession {
            id: session,
            _stop: stop,
        }
    }

    pub fn incoming(&self, session: u64, address: IpAddr) {
        if !public_ipv4(address) {
            return;
        }
        self.update(session, |state| {
            state.last_incoming = Some(Instant::now());
            state.snapshot.incoming_connections += 1;
            state.snapshot.status = DirectStatus::Reachable;
            state.snapshot.message = "An outside connection reached this listening port.".into();
        });
    }

    pub fn expire_evidence(&self, session: u64) {
        self.update(session, |state| {
            if state
                .last_incoming
                .is_some_and(|when| when.elapsed() >= EVIDENCE_LIFETIME)
            {
                state.last_incoming = None;
                state.snapshot.status = DirectStatus::Unknown;
                state.snapshot.message =
                    "No recent outside connection. Test the port to refresh reachability.".into();
            }
        });
    }

    pub async fn test(&self) -> Result<ReachabilitySnapshot, String> {
        let (session, port, local_ip, started) = {
            let mut state = self.inner.lock().unwrap();
            let port = state
                .snapshot
                .advertised_port
                .ok_or("Connect before testing the listening port.")?;
            if state.snapshot.checking {
                return Err("A reachability test is already running.".into());
            }
            if state
                .last_test
                .is_some_and(|time| time.elapsed() < Duration::from_secs(10))
            {
                return Err("Wait ten seconds between port tests.".into());
            }
            let started = Instant::now();
            state.last_test = Some(started);
            state.snapshot.checking = true;
            state.snapshot.message = "Asking Soulseek's port checker to connect…".into();
            let _ = self.app.emit(EVENT, state.snapshot.clone());
            (state.session, port, state.local_ip, started)
        };
        // The official checker is HTTP-only (its HTTPS certificate does not
        // cover tools.slsknet.org). No account data is sent. An OPEN response is
        // never sufficient evidence: the listener must observe an outside TCP.
        let result = check_port(port, local_ip).await;
        let (closed, detail) = match result {
            Ok(true) => (true, "Soulseek's checker could not connect. Check router forwarding, Windows Firewall, and VPN/CGNAT settings.".into()),
            Ok(false) => (false, "The checker replied, but no outside connection was observed. Reachability remains unknown.".into()),
            Err(error) => (false, format!("Port checker unavailable: {error}. Reachability remains unknown.")),
        };
        let mut state = self.inner.lock().unwrap();
        state.finish_test(session, port, started, closed, detail);
        let snapshot = state.snapshot.clone();
        let _ = self.app.emit(EVENT, &snapshot);
        Ok(snapshot)
    }

    async fn mapping_worker(
        &self,
        session: u64,
        local_ip: IpAddr,
        port: u16,
        mut stop: oneshot::Receiver<()>,
        diagnostics: Diagnostics,
    ) {
        let _lock = tokio::select! {
            _ = &mut stop => return,
            lock = self.mapping_lock.lock() => lock,
        };
        loop {
            if stop.try_recv() != Err(oneshot::error::TryRecvError::Empty) {
                return;
            }
            // Do not cancel creation midway on disconnect: collect the result
            // and delete it even if the session ended during discovery.
            match create_mapping(local_ip, port).await {
                Ok(mapping) => {
                    let (result, removed) = own_lease(mapping, &mut stop, |lease| {
                        self.update(session, |state| {
                            let external = lease.port();
                            if state.snapshot.advertised_port != Some(external) {
                                state.last_incoming = None;
                                state.snapshot.status = DirectStatus::Unknown;
                                state.snapshot.message = "The advertised port changed; waiting for an outside connection or a new test.".into();
                            }
                            state.snapshot.advertised_port = Some(external);
                            state.snapshot.mapping = lease.name().into();
                            state.snapshot.mapping_message = format!("{} maps external TCP {external} to local TCP {port}; lease renews automatically.", lease.name());
                        });
                    }).await;
                    if let Err(error) = removed {
                        diagnostics.record("warn", "port_mapping_cleanup", &format!("Could not delete the leased router mapping: {error}. It will expire on the router."));
                    }
                    if result.is_ok() {
                        return;
                    }
                    self.update(session, |state| {
                        state.last_incoming = None;
                        state.snapshot.status = DirectStatus::Unknown;
                        state.snapshot.message =
                            "Router lease renewal failed; test again after mapping recovers."
                                .into();
                    });
                    diagnostics.record(
                        "warn",
                        "port_mapping_renewal",
                        "Router lease renewal failed; retrying discovery.",
                    );
                }
                Err(error) => diagnostics.record("info", "port_mapping_unavailable", &error),
            }
            self.update(session, |state| {
                state.snapshot.mapping = "unavailable".into();
                state.snapshot.mapping_message = "Automatic mapping unavailable; use manual router forwarding. Retrying in five minutes.".into();
                state.snapshot.advertised_port = Some(port);
                if state.snapshot.status != DirectStatus::Reachable {
                    state.snapshot.status = DirectStatus::Unknown;
                }
            });
            tokio::select! { _ = &mut stop => return, _ = tokio::time::sleep(Duration::from_secs(300)) => {} }
        }
    }

    pub async fn wait_for_cleanup(&self) {
        let workers = std::mem::take(&mut *self.workers.lock().unwrap());
        for worker in workers {
            let _ = worker.await;
        }
    }
}

pub async fn bind_listener(preferred: u16) -> std::io::Result<TcpListener> {
    // Try the configured port and at most six successors, then an OS-selected
    // port. Keep the preference intact; the actual bound port is always shown.
    for port in preferred..=preferred.saturating_add(6) {
        match TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await {
            Ok(listener) => return Ok(listener),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::AddrInUse | std::io::ErrorKind::PermissionDenied
                ) => {}
            Err(error) => return Err(error),
        }
    }
    TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await
}

fn public_ipv4(address: IpAddr) -> bool {
    let IpAddr::V4(ip) = address else {
        return false;
    };
    let [a, b, _, _] = ip.octets();
    !ip.is_private()
        && !ip.is_loopback()
        && !ip.is_link_local()
        && !ip.is_broadcast()
        && !ip.is_documentation()
        && a != 0
        && a < 224
        && !(a == 100 && (64..=127).contains(&b))
        && !(a == 198 && (b == 18 || b == 19))
}

async fn check_port(port: u16, local_ip: Option<IpAddr>) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .local_address(local_ip)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get("http://tools.slsknet.org/porttest.php")
        .query(&[("port", port)])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if body.len() + chunk.len() > 32 * 1024 {
            return Err("Unexpectedly large checker response".into());
        }
        body.extend_from_slice(&chunk);
    }
    parse_check_response(&String::from_utf8_lossy(&body), port)
}

fn parse_check_response(body: &str, port: u16) -> Result<bool, String> {
    if body.contains(&format!("Port: {port}/tcp CLOSED")) {
        Ok(true)
    } else if body.contains(&format!("Port: {port}/tcp OPEN")) {
        Ok(false)
    } else {
        Err("Unrecognized checker response".into())
    }
}

trait Lease {
    fn delay(&self) -> Duration;
    fn renew(&mut self) -> impl Future<Output = Result<(), String>> + Send;
    fn remove(self) -> impl Future<Output = Result<(), String>> + Send;
}

async fn own_lease<L: Lease>(
    mut lease: L,
    stop: &mut oneshot::Receiver<()>,
    updated: impl FnMut(&L),
) -> (Result<(), String>, Result<(), String>) {
    let result = maintain_lease(&mut lease, stop, updated).await;
    let removed = lease.remove().await;
    (result, removed)
}

async fn maintain_lease<L: Lease>(
    lease: &mut L,
    stop: &mut oneshot::Receiver<()>,
    mut updated: impl FnMut(&L),
) -> Result<(), String> {
    loop {
        if stop.try_recv() != Err(oneshot::error::TryRecvError::Empty) {
            return Ok(());
        }
        updated(lease);
        tokio::select! { _ = &mut *stop => return Ok(()), _ = tokio::time::sleep(lease.delay()) => {} }
        lease.renew().await?;
    }
}

enum Mapping {
    Upnp {
        gateway: Box<Gateway<Tokio>>,
        local: SocketAddr,
        external: u16,
    },
    Nat(PortMapping),
}

impl Mapping {
    fn port(&self) -> u16 {
        match self {
            Self::Upnp { external, .. } => *external,
            Self::Nat(mapping) => mapping.external_port().get(),
        }
    }
    fn name(&self) -> &'static str {
        match self {
            Self::Upnp { .. } => "UPnP",
            Self::Nat(mapping) => match mapping.mapping_type() {
                PortMappingType::NatPmp => "NAT-PMP",
                PortMappingType::Pcp { .. } => "PCP",
            },
        }
    }
    async fn delete(self) -> Result<(), String> {
        match self {
            Self::Upnp {
                gateway, external, ..
            } => timeout(
                ROUTER_TIMEOUT,
                gateway.remove_port(PortMappingProtocol::TCP, external),
            )
            .await
            .map_err(|_| "UPnP deletion timed out".to_string())?
            .map_err(|error| error.to_string()),
            Self::Nat(mapping) => mapping
                .try_drop()
                .await
                .map_err(|(error, _)| error.to_string()),
        }
    }
}

impl Lease for Mapping {
    async fn remove(self) -> Result<(), String> {
        self.delete().await
    }
    fn delay(&self) -> Duration {
        let seconds = match self {
            Self::Upnp { .. } => LEASE_SECONDS,
            Self::Nat(mapping) => mapping.lifetime(),
        };
        Duration::from_secs(u64::from(seconds.max(1))) / 2
    }
    async fn renew(&mut self) -> Result<(), String> {
        match self {
            Self::Upnp {
                gateway,
                local,
                external,
            } => timeout(
                ROUTER_TIMEOUT,
                gateway.add_port(
                    PortMappingProtocol::TCP,
                    *external,
                    *local,
                    LEASE_SECONDS,
                    "Forever Soulseek",
                ),
            )
            .await
            .map_err(|_| "UPnP renewal timed out".to_string())?
            .map_err(|error| error.to_string()),
            Self::Nat(mapping) => {
                mapping.renew().await.map_err(|error| error.to_string())?;
                if mapping.lifetime() == 0 {
                    Err("Router returned an expired lease".into())
                } else {
                    Ok(())
                }
            }
        }
    }
}

async fn create_mapping(local_ip: IpAddr, port: u16) -> Result<Mapping, String> {
    let options = SearchOptions {
        bind_addr: SocketAddr::new(local_ip, 0),
        timeout: Some(Duration::from_secs(2)),
        ..SearchOptions::default()
    };
    if let Ok(Ok(gateway)) = timeout(ROUTER_TIMEOUT, search_gateway(options)).await {
        let local = SocketAddr::new(local_ip, port);
        if let Ok(Ok(())) = timeout(
            ROUTER_TIMEOUT,
            gateway.add_port(
                PortMappingProtocol::TCP,
                port,
                local,
                LEASE_SECONDS,
                "Forever Soulseek",
            ),
        )
        .await
        {
            return Ok(Mapping::Upnp {
                gateway: Box::new(gateway),
                local,
                external: port,
            });
        }
    }
    // Select the gateway for the interface actually used by the server socket,
    // not an arbitrary interface (important with VPNs and multiple adapters).
    let interfaces = tauri::async_runtime::spawn_blocking(netdev::get_interfaces)
        .await
        .map_err(|error| error.to_string())?;
    let gateway = interfaces
        .into_iter()
        .find(|interface| {
            interface
                .ipv4
                .iter()
                .any(|ip| IpAddr::V4(ip.addr()) == local_ip)
        })
        .and_then(|interface| interface.gateway)
        .and_then(|gateway| gateway.ipv4.first().copied())
        .ok_or("No IPv4 gateway found for the Soulseek network interface")?;
    let port = NonZeroU16::new(port).ok_or("Invalid listening port")?;
    let options = PortMappingOptions {
        external_port: Some(port),
        lifetime_seconds: Some(LEASE_SECONDS),
        timeout_config: Some(TimeoutConfig {
            initial_timeout: Duration::from_millis(250),
            max_retries: 2,
            max_retry_timeout: Some(Duration::from_secs(1)),
        }),
    };
    let mapping = match PortMapping::new(
        gateway.into(),
        local_ip,
        InternetProtocol::Tcp,
        port,
        options,
    )
    .await
    {
        Ok(mapping) => mapping,
        Err(_) => {
            crab_nat::natpmp::port_mapping(gateway.into(), InternetProtocol::Tcp, port, options)
                .await
                .map_err(|error| error.to_string())?
        }
    };
    if mapping.lifetime() == 0 {
        return Err("Router returned an expired lease".into());
    }
    Ok(Mapping::Nat(mapping))
}

impl ReachabilityHub {
    pub(super) fn start_session_timer(
        &self,
        sender: tokio::sync::mpsc::Sender<super::session_timer::SessionEvent>,
    ) -> super::session_timer::SessionTimer {
        super::session_timer::spawn(
            Duration::from_secs(1),
            sender,
            super::session_timer::SessionEvent::Network,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn listener_falls_back_without_releasing_the_occupied_port() {
        let occupied = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await.unwrap();
        let port = occupied.local_addr().unwrap().port();
        let listener = bind_listener(port).await.unwrap();
        assert_ne!(listener.local_addr().unwrap().port(), port);
        assert_eq!(occupied.local_addr().unwrap().port(), port);
    }

    #[test]
    fn checker_requires_exact_port_and_known_response() {
        assert_eq!(
            parse_check_response("IP: 1.2.3.4 Port: 2234/tcp CLOSED.", 2234),
            Ok(true)
        );
        assert_eq!(
            parse_check_response("Port: 2234/tcp OPEN.", 2234),
            Ok(false)
        );
        assert!(parse_check_response("Port: 2235/tcp OPEN.", 2234).is_err());
        assert!(parse_check_response("Gateway unavailable", 2234).is_err());
    }

    #[test]
    fn local_connections_do_not_prove_wan_reachability() {
        for ip in [
            "127.0.0.1",
            "192.168.1.3",
            "10.0.0.4",
            "100.64.1.1",
            "169.254.2.3",
            "::1",
        ] {
            assert!(!public_ipv4(ip.parse().unwrap()));
        }
        assert!(public_ipv4("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn stale_tests_cannot_change_a_new_session_or_port_and_incoming_wins() {
        let started = Instant::now();
        let mut state = Evidence {
            session: 2,
            snapshot: ReachabilitySnapshot {
                listen_port: Some(2234),
                advertised_port: Some(2234),
                checking: true,
                ..Default::default()
            },
            local_ip: None,
            last_incoming: Some(started),
            last_test: None,
        };
        state.finish_test(1, 2234, started, true, "closed".into());
        assert!(state.snapshot.checking);
        state.finish_test(2, 2235, started, true, "closed".into());
        assert_eq!(state.snapshot.status, DirectStatus::Unknown);
        state.finish_test(2, 2234, started, true, "closed".into());
        assert_eq!(state.snapshot.status, DirectStatus::Reachable);
        state.last_incoming = None;
        state.finish_test(2, 2234, started, true, "closed".into());
        assert_eq!(state.snapshot.status, DirectStatus::Firewalled);
    }

    #[tokio::test]
    async fn lease_worker_renews_and_stops_on_owner_drop_or_failure() {
        struct FakeLease {
            renewals: usize,
            fail: bool,
        }
        impl Lease for FakeLease {
            async fn remove(self) -> Result<(), String> {
                Ok(())
            }
            fn delay(&self) -> Duration {
                Duration::ZERO
            }
            async fn renew(&mut self) -> Result<(), String> {
                self.renewals += 1;
                if self.fail {
                    Err("router lost".into())
                } else {
                    Ok(())
                }
            }
        }
        let (sender, mut stop) = oneshot::channel();
        let mut sender = Some(sender);
        let mut lease = FakeLease {
            renewals: 0,
            fail: false,
        };
        maintain_lease(&mut lease, &mut stop, |lease| {
            if lease.renewals == 2 {
                sender.take();
            }
        })
        .await
        .unwrap();
        assert_eq!(lease.renewals, 2);
        let (_sender, mut stop) = oneshot::channel();
        lease.fail = true;
        assert!(maintain_lease(&mut lease, &mut stop, |_| {}).await.is_err());
    }

    #[tokio::test]
    async fn owned_lease_is_deleted_after_renewal_failure_or_disconnect_during_creation() {
        struct FakeLease(Arc<Mutex<Vec<&'static str>>>);
        impl Lease for FakeLease {
            fn delay(&self) -> Duration {
                Duration::ZERO
            }
            async fn renew(&mut self) -> Result<(), String> {
                self.0.lock().unwrap().push("renew");
                Err("failed".into())
            }
            async fn remove(self) -> Result<(), String> {
                self.0.lock().unwrap().push("delete");
                Ok(())
            }
        }
        let calls = Arc::new(Mutex::new(Vec::new()));
        let (sender, mut stop) = oneshot::channel();
        let (result, cleanup) = own_lease(FakeLease(calls.clone()), &mut stop, |_| {}).await;
        assert!(result.is_err());
        assert!(cleanup.is_ok());
        assert_eq!(*calls.lock().unwrap(), vec!["renew", "delete"]);
        drop(sender);
        calls.lock().unwrap().clear();
        let (sender, mut stop) = oneshot::channel();
        drop(sender); // owner disappeared while the router was creating the lease
        let (result, cleanup) = own_lease(FakeLease(calls.clone()), &mut stop, |_| {
            panic!("must not publish a stale mapping")
        })
        .await;
        assert!(result.is_ok() && cleanup.is_ok());
        assert_eq!(*calls.lock().unwrap(), vec!["delete"]);
    }

    #[tokio::test]
    async fn nat_pmp_router_assigns_external_port_renews_then_receives_delete() {
        use tokio::net::UdpSocket;
        // A loopback gateway exercises the real NAT-PMP wire implementation.
        let gateway = UdpSocket::bind("127.0.0.2:5351").await.unwrap();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for index in 0..3 {
                let mut bytes = [0_u8; 64];
                let (len, client) = timeout(Duration::from_secs(3), gateway.recv_from(&mut bytes))
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(len, 12);
                assert_eq!(&bytes[..2], &[0, 2]);
                let lifetime = u32::from_be_bytes(bytes[8..12].try_into().unwrap());
                requests.push(lifetime);
                let mut reply = vec![0, 130, 0, 0];
                reply.extend_from_slice(&10_u32.to_be_bytes());
                reply.extend_from_slice(&bytes[4..6]);
                let external = if lifetime == 0 {
                    0_u16
                } else if index == 0 {
                    45000_u16
                } else {
                    45001_u16
                };
                reply.extend_from_slice(&external.to_be_bytes());
                reply.extend_from_slice(&(if lifetime == 0 { 0_u32 } else { 1_u32 }).to_be_bytes());
                gateway.send_to(&reply, client).await.unwrap();
            }
            requests
        });
        let mapping = crab_nat::natpmp::port_mapping(
            Ipv4Addr::new(127, 0, 0, 2).into(),
            InternetProtocol::Tcp,
            NonZeroU16::new(2234).unwrap(),
            PortMappingOptions {
                external_port: NonZeroU16::new(2234),
                lifetime_seconds: Some(30),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let (sender, mut stop) = oneshot::channel();
        let mut sender = Some(sender);
        let mut ports = Vec::new();
        let (result, cleanup) = own_lease(Mapping::Nat(mapping), &mut stop, |mapping| {
            ports.push(mapping.port());
            if ports.len() == 2 {
                sender.take();
            }
        })
        .await;
        assert!(
            result.is_ok() && cleanup.is_ok(),
            "renew={result:?}, cleanup={cleanup:?}"
        );
        assert_eq!(ports, vec![45000, 45001]);
        let requests = server.await.unwrap();
        assert!(requests[0] > 0 && requests[1] > 0);
        assert_eq!(requests[2], 0);
    }
}
