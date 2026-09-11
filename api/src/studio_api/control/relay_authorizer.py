"""The real RelayAuthorizer (ticket #3), backed by the control-plane
repository — replaces ticket #2's seeded allowlist."""

from studio_api.control.repository import ControlPlaneRepository


class WorkspaceMembershipAuthorizer:
    def __init__(self, repo: ControlPlaneRepository, *, workspace_slug: str) -> None:
        self._repo = repo
        self._workspace_slug = workspace_slug

    async def is_member(self, pubkey: str) -> bool:
        return await self._repo.get_workspace_role(self._workspace_slug, pubkey) is not None

    async def is_channel_member(self, channel_id: str, pubkey: str) -> bool:
        # Channel ids are globally unique, so membership alone says nothing
        # about which Workspace the Channel belongs to. This relay serves one
        # Workspace; a Channel in another is not its Channel (ticket #45).
        channel = await self._repo.get_channel(channel_id)
        if channel is None or channel.workspace_slug != self._workspace_slug:
            return False
        return await self._repo.is_channel_member(channel_id, pubkey)
