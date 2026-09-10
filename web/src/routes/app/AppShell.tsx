import type { WorkspaceOut } from "../../lib/api";
import { clearIdentity } from "../../lib/custody";

export function AppShell({ workspace, onSignOut }: { workspace: WorkspaceOut; onSignOut: () => void }) {
  const handleSignOut = async () => {
    await clearIdentity();
    onSignOut();
  };

  return (
    <div style={{ padding: 24 }} className="stack">
      <h1>{workspace.name}</h1>
      <p className="meta">Connected as {workspace.role} · {workspace.relay_url}</p>
      <button className="btn btn-outline" onClick={handleSignOut}>
        Sign out
      </button>
    </div>
  );
}
