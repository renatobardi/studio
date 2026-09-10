"""The real FirebaseVerifier (`studio_api.auth.FirebaseVerifier`), backed by
the Firebase Admin SDK. Credentials are a service-account JSON file path —
never the credential content itself — supplied via `FIREBASE_CREDENTIALS_PATH`.
"""

import firebase_admin
from firebase_admin import auth, credentials

from studio_api.auth import AuthError


class RealFirebaseVerifier:
    def __init__(self, credentials_path: str) -> None:
        cred = credentials.Certificate(credentials_path)
        self._app = firebase_admin.initialize_app(cred, name="studio")

    def verify(self, token: str) -> tuple[str, str]:
        try:
            decoded = auth.verify_id_token(token, app=self._app)
        except Exception as error:
            raise AuthError(f"invalid Firebase ID token: {error}") from error
        email = decoded.get("email")
        if not email:
            raise AuthError("Firebase ID token has no email claim")
        return decoded["uid"], email
