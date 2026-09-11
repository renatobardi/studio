"""Domain errors the media API raises. The REST layer maps each to an HTTP
status; nothing here knows about FastAPI."""


class MediaError(Exception):
    """Base for every error the media module raises."""


class UnsupportedMimeTypeError(MediaError):
    pass


class BlobTooLargeError(MediaError):
    pass


class Sha256MismatchError(MediaError):
    pass


class BlobNotFoundError(MediaError):
    pass


class BlobForbiddenError(MediaError):
    """The caller is neither the uploader nor a Member of any Channel the
    blob is referenced in."""
