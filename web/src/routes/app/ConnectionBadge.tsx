import type { ConnectionState } from "../../lib/relay";

const LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`connection-badge connection-badge-${state}`} data-testid="connection-state">
      {LABEL[state]}
    </span>
  );
}
