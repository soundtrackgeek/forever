# Connection service

`connection/service.rs` is the application facade: it owns shared hubs, exposes
the existing Tauri-facing methods, and starts/stops connection attempts. Protocol
work is split into the following internal modules:

| Module | Responsibility |
| --- | --- |
| `service/session.rs` | Authentication, one server writer, bounded incoming frames, and the session event pump |
| `service/server.rs` | Code-based dispatch of session messages: peer addresses, connection requests, and distributed topology |
| `service/hubs.rs` | Registered hub frame handlers and shared connected/disconnected hooks |
| `service/commands.rs` | Serialized command writes, transfer admission, and peer-request dispatch |
| `service/network.rs` | Distributed parent candidates, adoption, branch updates, and announcements |
| `service/connection.rs` | Reconnect policy and governed search dispatch |
| `service/peers.rs` | Direct/indirect peer negotiation, bounded peer messages, and file IO |
| `download_scheduler.rs` | Coalesced lifecycle wakeups and retry-deadline waits |
| `session_timer.rs` | Bounded, cancellable timer producers |

Hub registrations declare their server codes and implement `on_server_frame`,
`on_connected`, and `on_disconnected`. Cross-hub effects have a small injectable
context so routing and lifecycle behavior can be tested without a desktop runtime.
Incoming private messages still persist before the acknowledgement is written;
ignored senders are acknowledged without saving their messages. Unknown server
codes are ignored, and malformed optional lists retain the last valid state.

The session remains the only writer to the server socket. The dedicated frame
reader is retained because cancelling `read_exact` halfway through a frame can
desynchronize the connection. Commands, timer events, peer accepts, and distributed
events cannot cancel that reader. Timer events use a bounded queue of eight;
their tasks abort when the attempt ends, including while blocked on a full queue.
The search governor owns its 250 ms cadence; reachability, uploads, and share-count
maintenance own their one-second cadences. Keepalive remains session-owned.
Timers skip missed ticks rather than generating catch-up bursts.

Downloads have no periodic scheduling tick. Enqueue, lifecycle changes, lane
settings, and restart-preparation cancellation notify the transfer hub's scheduler.
The next eligible retry gets one deadline. A retry blocked by all lanes or by an
active transfer from the same source has no timer: slot release wakes it. The
pending wait is retained across unrelated session events. Transfer telemetry does
not notify the scheduler. One source per lane, configured lane limits, and the
existing 5/15/45-second retry policy are unchanged.

Explicit disconnect and interrupted connections use the same hub cleanup hooks.
Both reset transient transfer/profile/share/network state, requeue interrupted
uploads, clear server privileges, and fail unsent messages. Requested disconnect
stops searches; interrupted connections mark them failed. Reconnect restores room
joins, watched users, and queue scheduling through the same registry. An old
connection attempt checks its generation before publishing disconnect cleanup.

Verification includes dispatch of valid/malformed/unknown frames, both disconnect
reasons, upload requeue/persistence and stale callbacks, retry eligibility, virtual
time wakeups, bounded timer cancellation, fragmented server reads, and existing
loopback peer tests. The [parser fuzz workspace](../src-tauri/fuzz/README.md) tests
the exact production parser source separately from Tauri, with three seeded
AddressSanitizer targets and an independent CI smoke workflow.

These checks do not establish live public Soulseek interoperability or an
installed application's transfer behavior. No protocol format, store schema, IPC
command, or frontend event contract changes in this refactor.
