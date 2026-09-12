import { useCallback, useEffect, useState } from "react";
import { authProof, listWorkspaceMembers, type WorkspaceMemberOut } from "../../lib/api";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";

/**
 * The Workspace's own member list, read over REST — the owner's decision for
 * this selector (#47). Any Workspace Member may read it; the 13534 projection
 * mirrors the same table, and re-reading on each of its publications is how
 * the list stays current without polling (ADR-0002).
 */
export function useWorkspaceMembers(
  client: RelayClient,
  slug: string,
  signer: Signer,
): { members: WorkspaceMemberOut[]; error: string | null } {
  const [members, setMembers] = useState<WorkspaceMemberOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const url = `${window.location.origin}/api/workspaces/${slug}/members`;
      const list = await listWorkspaceMembers(slug, await authProof(url, "GET", signer));
      setMembers(list);
      setError(null);
    } catch {
      setError("Couldn't load the Workspace's members. Check your connection.");
    }
  }, [slug, signer]);

  useEffect(() => {
    (async () => {
      await reload();
    })();
  }, [reload]);

  // Someone admitted while this pane is open should be selectable without a
  // reload — the same re-read-on-projection the admin console does (#42).
  useEffect(() => {
    return client.subscribe([{ kinds: [13534] }], { onEvent: () => void reload() });
  }, [client, reload]);

  return { members, error };
}
