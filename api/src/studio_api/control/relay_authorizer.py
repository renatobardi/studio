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
        return await self._repo.is_channel_member(channel_id, pubkey)
