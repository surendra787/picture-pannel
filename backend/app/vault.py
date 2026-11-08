
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Vault, VaultSession
from app.security import (
    get_password_fingerprint,
    create_vault_check,
    derive_encryption_key,
    wrap_encryption_key,
    create_access_token,
    hash_access_token,
    verify_vault_password
)

bearer_scheme = HTTPBearer(auto_error=False)

SESSION_HOURS = 12


def open_or_create_vault(password: str, db: Session):
    fingerprint = get_password_fingerprint(password)

    vault = db.query(Vault).filter(
        Vault.password_fingerprint == fingerprint
    ).first()

    created = False

    if vault:
        if not verify_vault_password(password, vault):
            raise HTTPException(
                status_code=401,
                detail="Unable to unlock this vault."
            )
    else:
        salt, nonce, encrypted_check = create_vault_check(password)

        vault = Vault(
            password_fingerprint=fingerprint,
            encryption_salt=salt,
            check_nonce=nonce,
            encrypted_check=encrypted_check
        )

        db.add(vault)

        try:
            db.commit()
            db.refresh(vault)
            created = True

        except Exception:
            db.rollback()

            vault = db.query(Vault).filter(
                Vault.password_fingerprint == fingerprint
            ).first()

            if not vault or not verify_vault_password(password, vault):
                raise HTTPException(
                    status_code=409,
                    detail="Vault creation failed. Please try again."
                )

    # Derive the media encryption key after verification
    encryption_key = derive_encryption_key(
        password,
        vault.encryption_salt
    )

    # Wrap the key for this authenticated session
    wrap_nonce, wrapped_key = wrap_encryption_key(
        encryption_key,
        vault.id
    )

    token = create_access_token()

    session = VaultSession(
        vault_id=vault.id,
        token_hash=hash_access_token(token),
        wrapped_key=wrapped_key,
        wrap_nonce=wrap_nonce,
        expires_at=datetime.now(timezone.utc) + timedelta(
            hours=SESSION_HOURS
        )
    )

    db.add(session)
    db.commit()

    return {
        "message": (
            "New vault created successfully."
            if created else "Existing vault opened successfully."
        ),
        "status": "created" if created else "existing",
        "vault_id": vault.id,
        "access_token": token
    }


def get_active_session(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db)
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Vault is locked. Enter your password."
        )

    token_hash = hash_access_token(credentials.credentials)

    session = db.query(VaultSession).filter(
        VaultSession.token_hash == token_hash,
        VaultSession.expires_at > datetime.now(timezone.utc)
    ).first()

    if not session:
        raise HTTPException(
            status_code=401,
            detail="Session expired. Unlock your vault again."
        )

    return session


def get_session_encryption_key(session: VaultSession) -> bytes:
    from app.security import unwrap_encryption_key

    try:
        return unwrap_encryption_key(
            session.wrap_nonce,
            session.wrapped_key,
            session.vault_id
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Unable to access the vault encryption key."
        )
