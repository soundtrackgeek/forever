import type { ConnectionProfile, DistributedSnapshot, ReachabilitySnapshot } from "../types";

type Props = {
  draft: ConnectionProfile;
  onChange: (profile: ConnectionProfile) => void;
  network: ReachabilitySnapshot;
  distributed: DistributedSnapshot;
  online: boolean;
  onTest: () => Promise<unknown>;
};

export function ReachabilitySettings({ draft, onChange, network, distributed, online, onTest }: Props) {
  return (
    <fieldset className="reachability-settings">
      <legend>Direct connections</legend>
      <p>A stable listening port helps other listeners reach your shares and transfers.</p>
      <label className="connection-field">
        <span>Listening port</span>
        <input required type="number" min={1} max={65535} value={draft.listenPort}
          onChange={(event) => onChange({ ...draft, listenPort: Number(event.target.value) })} />
        <small>Default 2234. If busy, Forever tries the next six ports, then an available port.</small>
      </label>
      <div className="settings-toggle-grid">
        <label className="toggle-row">
          <input type="checkbox" checked={draft.automaticPortMapping}
            onChange={(event) => onChange({ ...draft, automaticPortMapping: event.target.checked })} />
          <span className="toggle-visual" aria-hidden="true"><i /></span>
          <span><strong>Automatic router mapping</strong><small>Use UPnP, PCP, or NAT-PMP. Leases renew while connected and are removed on disconnect.</small></span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={draft.allowDistributedChildren}
            onChange={(event) => onChange({ ...draft, allowDistributedChildren: event.target.checked })} />
          <span className="toggle-visual" aria-hidden="true"><i /></span>
          <span><strong>Help relay global searches</strong><small>Accept up to four children after reachability, a stable relay, and the server’s speed requirements are confirmed.</small></span>
        </label>
      </div>
      <div className="reachability-evidence" aria-live="polite">
        <strong>Direct connections: {network.status}</strong>
        <p>{network.message}</p>
        <dl>
          <div><dt>Listening / advertised port</dt><dd>{network.listenPort ?? "—"} / {network.advertisedPort ?? "—"}</dd></div>
          <div><dt>Router mapping</dt><dd>{network.mapping}</dd></div>
          <div><dt>Distributed role</dt><dd>{distributed.children > 0 ? "Branch" : distributed.acceptingChildren ? "Branch ready" : "Leaf"} · {distributed.children}/{distributed.childCapacity} children · {distributed.searchesRelayed} relayed</dd></div>
        </dl>
        <p>{network.mappingMessage}</p>
        <button type="button" className="secondary-text-button" disabled={!online || network.checking}
          onClick={() => void onTest()}>{network.checking ? "Testing direct connections…" : "Test direct connections"}</button>
        <small>The test sends your advertised port to Soulseek’s public port checker over HTTP. Incoming outside connections confirm reachability; unavailable tests stay unknown.</small>
      </div>
      <p className="reachability-save-note">Save changes and reconnect to apply. For manual forwarding, use the actual listening port shown above and allow Forever through Windows Firewall.</p>
    </fieldset>
  );
}
