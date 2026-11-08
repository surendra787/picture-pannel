
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    Integer,
    String,
    BigInteger,
    DateTime,
    ForeignKey,
    LargeBinary
)
from sqlalchemy.orm import relationship

from app.database import Base


class Vault(Base):
    __tablename__ = "vaults"

    id = Column(Integer, primary_key=True, index=True)

    password_fingerprint = Column(
        String(64),
        unique=True,
        nullable=False,
        index=True
    )

    encryption_salt = Column(LargeBinary, nullable=False)
    check_nonce = Column(LargeBinary, nullable=False)
    encrypted_check = Column(LargeBinary, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    files = relationship(
        "StoredFile",
        back_populates="vault",
        cascade="all, delete-orphan"
    )


class StoredFile(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)

    vault_id = Column(
        Integer,
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    original_name = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=False)
    mime_type = Column(String(100), nullable=False)
    storage_path = Column(String(500), nullable=False)
    file_size = Column(BigInteger, nullable=False)
    encryption_nonce = Column(LargeBinary, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    vault = relationship(
        "Vault",
        back_populates="files"
    )


class VaultSession(Base):
    __tablename__ = "vault_sessions"

    id = Column(Integer, primary_key=True, index=True)

    vault_id = Column(
        Integer,
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    token_hash = Column(
        String(64),
        unique=True,
        nullable=False,
        index=True
    )

    wrapped_key = Column(LargeBinary, nullable=False)
    wrap_nonce = Column(LargeBinary, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    expires_at = Column(
        DateTime(timezone=True),
        nullable=False
    )

