import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, DistributedSnapshot, ReachabilitySnapshot } from "../types";
import { ReachabilitySettings } from "./ReachabilitySettings";

const profile: ConnectionProfile = { username: "tester", serverHost: "server.slsknet.org", serverPort: 2242, downloadDirectory: "C:\\Downloads", rememberPassword: true, autoConnect: false, listenPort: 2234, automaticPortMapping: true, allowDistributedChildren: true };
const network: ReachabilitySnapshot = { status: "unknown", message: "Waiting for an outside connection.", listenPort: 2235, advertisedPort: 45000, mapping: "NAT-PMP", mappingMessage: "External TCP 45000 maps to local TCP 2235.", checking: false, incomingConnections: 0 };
const distributed: DistributedSnapshot = { state: "connected", message: "Connected", branchLevel: 1, acceptingChildren: true, children: 2, childCapacity: 4, searchesRelayed: 73, searchesReceived: 80, searchesAnswered: 3, searchesIgnored: 0, searchesMatched: 3, updatedAtMs: 0 };

describe("direct connection settings", () => {
  it("keeps the saved preference distinct from the real mapped ports and role", () => {
    const onChange = vi.fn(); const onTest = vi.fn().mockResolvedValue(undefined);
    render(<ReachabilitySettings draft={profile} onChange={onChange} network={network} distributed={distributed} online onTest={onTest} />);
    expect(screen.getByRole("spinbutton", { name: /Listening port/ })).toHaveValue(2234);
    expect(screen.getByText("2235 / 45000")).toBeInTheDocument();
    expect(screen.getByText(/Branch · 2\/4 children · 73 relayed/)).toBeInTheDocument();
    expect(screen.getByText("Direct connections: unknown")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Listening port/ }), { target: { value: "2240" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, listenPort: 2240 });
    fireEvent.click(screen.getByRole("checkbox", { name: /Automatic router mapping/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, automaticPortMapping: false });
    fireEvent.click(screen.getByRole("checkbox", { name: /Help relay global searches/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, allowDistributedChildren: false });
    fireEvent.click(screen.getByRole("button", { name: "Test direct connections" }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it("blocks tests while offline or checking and explains unavailable results", () => {
    const onTest = vi.fn();
    const { rerender } = render(<ReachabilitySettings draft={profile} onChange={vi.fn()} network={network} distributed={distributed} online={false} onTest={onTest} />);
    fireEvent.click(screen.getByRole("button", { name: "Test direct connections" }));
    expect(onTest).not.toHaveBeenCalled();
    rerender(<ReachabilitySettings draft={profile} onChange={vi.fn()} network={{ ...network, checking: true }} distributed={distributed} online onTest={onTest} />);
    expect(screen.getByRole("button", { name: "Testing direct connections…" })).toBeDisabled();
    rerender(<ReachabilitySettings draft={profile} onChange={vi.fn()} network={{ ...network, message: "Port checker unavailable. Reachability remains unknown." }} distributed={distributed} online onTest={onTest} />);
    expect(screen.getByText("Port checker unavailable. Reachability remains unknown.")).toBeInTheDocument();
    expect(screen.getByText("Direct connections: unknown")).toBeInTheDocument();
  });
});
