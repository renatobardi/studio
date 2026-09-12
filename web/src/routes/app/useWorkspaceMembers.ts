import { useEffect, useState } from "react";
import { authProof, listWorkspaceMembers, type WorkspaceMemberOut } from "../../lib/api";
import type { Signer } from "../../lib/custody";

/**
 * The Workspace's own member list, read over REST — the owner's decision for
 * this selector (#47). Any Workspace Member may read it; the 13534 projection
 * mirrors the same table, and re-reading on each of its publications is how
 * the list stays current without polling (ADR-0002).
 */
export function useWorkspaceMembers(
  slug: string,
  signer: Signer,
): { members: WorkspaceMemberOut[]; error: string | null } {
  const [members, setMembers] = useState<WorkspaceMemberOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `${window.location.origin}/api/workspaces/${slug}/members`;
        const list = await listWorkspaceMembers(slug, await authProof(url, "GET", signer));
        if (cancelled) return;
        setMembers(list);
        setError(null);
      } catch {
        if (!cancelled) setError("Couldn't load the Workspace's members. Check your connection.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, signer]);

  return { members, error };
}
