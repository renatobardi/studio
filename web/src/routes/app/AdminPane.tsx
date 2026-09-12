import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { authProof, type ChannelOut, type InviteOut, type WorkspaceMemberOut } from "../../lib/api";
import { ACCESS_PROJECTION_KINDS, isWorkspaceManager, manageableChannels } from "../../lib/channelAccess";
import { describeInvite, inviteLimits, inviteLink } from "../../lib/invites";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import { displayName, useProfiles } from "./useProfiles";
import { MemberProfile } from "./MemberProfile";

type AdminTab = "invites" | "members" | "channels";

/** The admin console. A Workspace owner/admin gets all of it: Invites,
 * Workspace Members and Channels — the REST admin surface (ADR-0002: this is
 * the source of truth the server projects into NIP-43/NIP-29 events). A
 * Channel admin who holds no Workspace role gets only the Channels tab, and
 * only the Channels they administer (#42); the API enforces the same line. */
export function AdminPane({
  client,
  signer,
  slug,
  workspaceRole,
}: Readonly<{ client: RelayClient; signer: Signer; slug: string; workspaceRole: string }>) {
  const isManager = isWorkspaceManager(workspaceRole);
  const [tab, setTab] = useState<AdminTab>(isManager ? "invites" : "channels");

  return (
    <div className="card stack" data-testid="admin-pane">
      <nav className="button-group" aria-label="Admin section">
        {isManager && (
          <>
            <button className={`btn btn-outline${tab === "invites" ? " active" : ""}`} onClick={() => setTab("invites")}>
              Invites
            </button>
            <button className={`btn btn-outline${tab === "members" ? " active" : ""}`} onClick={() => setTab("members")}>
              Members
            </button>
          </>
        )}
        <button
          className={`btn btn-outline${tab === "channels" ? " active" : ""}`}
          onClick={() => setTab("channels")}
        >
          Channels
        </button>
      </nav>
      {tab === "invites" && isManager && <InvitesTab signer={signer} slug={slug} />}
      {tab === "members" && isManager && <MembersTab client={client} signer={signer} slug={slug} />}
      {tab === "channels" && (
        <ChannelsTab client={client} signer={signer} slug={slug} workspaceRole={workspaceRole} />
      )}
    </div>
  );
}

async function proofFor(slug: string, path: string, method: string, signer: Signer): Promise<string> {
  const url = `${window.location.origin}/api/workspaces/${slug}${path}`;
  return authProof(url, method, signer);
}

function InvitesTab({ signer, slug }: Readonly<{ signer: Signer; slug: string }>) {
  const [invites, setInvites] = useState<InviteOut[] | null>(null);
  const [role, setRole] = useState("member");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const proof = await proofFor(slug, "/invites", "GET", signer);
    setInvites(await api.listInvites(slug, proof));
    setCopied(null);
  }, [slug, signer]);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch {
        setError("Couldn't load Invites.");
      }
    })();
  }, [reload]);

  const create = async () => {
    setError(null);
    // Expiry and use limit are answered here rather than by a failed request:
    // the server refuses the same impossible limits, but only after a round
    // trip (#46).
    const limits = inviteLimits(
      { expiresInDays, maxUses },
      Math.floor(Date.now() / 1000),
    );
    if (!limits.ok) {
      setError(limits.error);
      return;
    }
    try {
      const proof = await proofFor(slug, "/invites", "POST", signer);
      await api.createInvite(slug, proof, { role, ...limits.body });
      setExpiresInDays("");
      setMaxUses("");
      await reload();
    } catch (caught) {
      setError(caught instanceof api.ApiError ? caught.message : "Couldn't create the Invite.");
    }
  };

  const revoke = async (code: string) => {
    setError(null);
    try {
      const proof = await proofFor(slug, `/invites/${code}`, "DELETE", signer);
      await api.revokeInvite(slug, code, proof);
      await reload();
    } catch {
      setError("Couldn't revoke the Invite.");
    }
  };

  const copyLink = async (code: string) => {
    setError(null);
    try {
      await navigator.clipboard.writeText(inviteLink(window.location.origin, code));
      setCopied(code);
    } catch {
      // An insecure context or a denied permission rejects here. Saying so
      // beats a button that claims a copy nobody made.
      setCopied(null);
      setError("Couldn't copy the link. Copy the code and share it instead.");
    }
  };

  return (
    <div className="stack" data-testid="invites-tab">
      {error && <div className="error-banner">{error}</div>}
      <div className="conversation-list-new">
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role granted">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <input
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
          aria-label="Expires in days"
          placeholder="Expires in days (optional)"
        />
        <input
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          aria-label="Maximum uses"
          placeholder="Max uses (optional)"
        />
        <button className="btn btn-primary" onClick={() => void create()}>
          Create Invite
        </button>
      </div>
      <ul className="member-list">
        {invites?.map((invite) => (
          <li key={invite.code} className="conversation-list-item-row">
            <span>
              {invite.code} · {invite.role} · {describeInvite(invite)}
            </span>
            <button className="btn btn-outline" onClick={() => void copyLink(invite.code)}>
              {copied === invite.code ? "Link copied" : "Copy link"}
            </button>
            {!invite.revoked && (
              <button className="btn btn-outline" onClick={() => void revoke(invite.code)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MembersTab({ client, signer, slug }: Readonly<{ client: RelayClient; signer: Signer; slug: string }>) {
  const [members, setMembers] = useState<WorkspaceMemberOut[] | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { profiles, ensure } = useProfiles(client);

  const reload = useCallback(async () => {
    const proof = await proofFor(slug, "/members", "GET", signer);
    const list = await api.listWorkspaceMembers(slug, proof);
    setMembers(list);
    ensure(list.map((m) => m.pubkey));
  }, [slug, signer, ensure]);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch {
        setError("Couldn't load Workspace Members.");
      }
    })();
  }, [reload]);

  // Re-reads the REST list whenever the server projects a fresh kind 13534 Workspace member
  // list (ADR-0002) — picks up another admin's concurrent change, not just the caller's own.
  useEffect(() => {
    return client.subscribe([{ kinds: [13534] }], { onEvent: () => void reload() });
  }, [client, reload]);

  const changeRole = async (pubkey: string, role: string) => {
    setError(null);
    try {
      const proof = await proofFor(slug, `/members/${pubkey}`, "PATCH", signer);
      await api.setWorkspaceMemberRole(slug, pubkey, role, proof);
      await reload();
    } catch {
      setError("Couldn't change that member's role.");
    }
  };

  const remove = async (pubkey: string) => {
    setError(null);
    try {
      const proof = await proofFor(slug, `/members/${pubkey}`, "DELETE", signer);
      await api.removeWorkspaceMember(slug, pubkey, proof);
      await reload();
    } catch {
      setError("Couldn't remove that member.");
    }
  };

  if (viewing) return <MemberProfile client={client} pubkey={viewing} onClose={() => setViewing(null)} />;

  return (
    <div className="stack" data-testid="members-tab">
      {error && <div className="error-banner">{error}</div>}
      <ul className="member-list">
        {members?.map((member) => (
          <li key={member.pubkey} className="conversation-list-item-row">
            <button className="btn btn-outline" onClick={() => setViewing(member.pubkey)}>
              {displayName(profiles, member.pubkey)}
            </button>
            <select value={member.role} onChange={(e) => void changeRole(member.pubkey, e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <button className="btn btn-outline" onClick={() => void remove(member.pubkey)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChannelsTab({
  client,
  signer,
  slug,
  workspaceRole,
}: Readonly<{ client: RelayClient; signer: Signer; slug: string; workspaceRole: string }>) {
  const [channels, setChannels] = useState<ChannelOut[] | null>(null);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const proof = await proofFor(slug, "/channels", "GET", signer);
    setChannels(manageableChannels(workspaceRole, await api.listChannels(slug, proof)));
  }, [slug, signer, workspaceRole]);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch {
        setError("Couldn't load Channels.");
      }
    })();
  }, [reload]);

  // Another admin's Channel creation or membership change lands here the same
  // way it lands in the navigation: on the projection, re-read the REST list.
  // `since` keeps mounting from replaying every stored projection as its own
  // reload — only what happens from now on is news.
  useEffect(() => {
    const since = Math.floor(Date.now() / 1000);
    return client.subscribe([{ kinds: ACCESS_PROJECTION_KINDS, since }], {
      onEvent: () => void reload(),
    });
  }, [client, reload]);

  const create = async () => {
    setError(null);
    if (!name.trim()) return;
    try {
      const proof = await proofFor(slug, "/channels", "POST", signer);
      await api.createChannel(slug, proof, { name, about, private: isPrivate });
      setName("");
      setAbout("");
      setIsPrivate(false);
      await reload();
    } catch {
      setError("Couldn't create the Channel.");
    }
  };

  return (
    <div className="stack" data-testid="channels-tab">
      {error && <div className="error-banner">{error}</div>}
      {isWorkspaceManager(workspaceRole) && (
        <div className="field">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" />
          <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="About (optional)" />
          <label className="conversation-list-item-row">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            Private
          </label>
          <button className="btn btn-primary" onClick={() => void create()}>
            Create Channel
          </button>
        </div>
      )}
      <ul className="member-list">
        {channels?.map((channel) => (
          <li key={channel.id} className="conversation-list-item-row">
            <span>
              {channel.name}
              {channel.private ? " · private" : ""}
            </span>
            <button
              className="btn btn-outline"
              onClick={() => setManaging((current) => (current === channel.id ? null : channel.id))}
            >
              {managing === channel.id ? "Close" : "Manage members"}
            </button>
          </li>
        ))}
      </ul>
      {managing && <ChannelMembersEditor client={client} signer={signer} slug={slug} channelId={managing} />}
    </div>
  );
}

function ChannelMembersEditor({
  client,
  signer,
  slug,
  channelId,
}: Readonly<{ client: RelayClient; signer: Signer; slug: string; channelId: string }>) {
  const [members, setMembers] = useState<{ pubkey: string; role: string }[] | null>(null);
  const [newPubkey, setNewPubkey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { profiles, ensure } = useProfiles(client);

  const reload = useCallback(async () => {
    const proof = await proofFor(slug, `/channels/${channelId}/members`, "GET", signer);
    const list = await api.listChannelMembers(slug, channelId, proof);
    setMembers(list);
    ensure(list.map((m) => m.pubkey));
  }, [slug, channelId, signer, ensure]);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch {
        setError("Couldn't load Channel Members.");
      }
    })();
  }, [reload]);

  // Re-reads the REST list whenever the server projects a fresh kind 39002 Channel member list
  // (ADR-0002) — same projection MembersPane.tsx already subscribes to for the timeline view.
  useEffect(() => {
    return client.subscribe([{ kinds: [39002], "#d": [channelId] }], { onEvent: () => void reload() });
  }, [client, channelId, reload]);

  const add = async () => {
    setError(null);
    if (!newPubkey.trim()) return;
    try {
      const proof = await proofFor(slug, `/channels/${channelId}/members`, "POST", signer);
      await api.addChannelMember(slug, channelId, newPubkey.trim(), "member", proof);
      setNewPubkey("");
      await reload();
    } catch {
      setError("Couldn't add that Channel Member — check the pubkey.");
    }
  };

  const remove = async (pubkey: string) => {
    setError(null);
    try {
      const proof = await proofFor(slug, `/channels/${channelId}/members/${pubkey}`, "DELETE", signer);
      await api.removeChannelMember(slug, channelId, pubkey, proof);
      await reload();
    } catch {
      setError("Couldn't remove that Channel Member.");
    }
  };

  return (
    <div className="stack" data-testid="channel-members-editor">
      {error && <div className="error-banner">{error}</div>}
      <div className="conversation-list-new">
        <input value={newPubkey} onChange={(e) => setNewPubkey(e.target.value)} placeholder="Member pubkey" />
        <button className="btn btn-primary" onClick={() => void add()}>
          Add
        </button>
      </div>
      <ul className="member-list">
        {members?.map((member) => (
          <li key={member.pubkey} className="conversation-list-item-row">
            <span>
              {displayName(profiles, member.pubkey)} · {member.role}
            </span>
            <button className="btn btn-outline" onClick={() => void remove(member.pubkey)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
