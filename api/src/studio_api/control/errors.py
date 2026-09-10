"""Domain errors the control-plane repository raises. The REST layer maps
each to an HTTP status; nothing here knows about FastAPI."""


class ControlPlaneError(Exception):
    """Base for every error the repository raises."""


class AlreadyLinkedError(ControlPlaneError):
    """The Account already links a different Identity."""


class WorkspaceSlugTakenError(ControlPlaneError):
    pass


class InviteInvalidError(ControlPlaneError):
    """The invite code does not exist, is revoked, expired, or exhausted."""


class NotAWorkspaceMemberError(ControlPlaneError):
    """A Channel Member (or a Channel itself) must belong to a Workspace
    Member first."""


class CannotRemoveOwnerError(ControlPlaneError):
    pass
