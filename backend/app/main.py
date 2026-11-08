
from datetime import timezone

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    UploadFile,
    File
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from urllib.parse import quote

from app.database import get_db
from app.models import VaultSession, StoredFile
from app.vault import (
    open_or_create_vault,
    get_active_session,
    get_session_encryption_key
)
from app.security import hash_access_token
from app.file_manager import (
    save_encrypted_file,
    read_encrypted_file
)

app = FastAPI(
    title="CodedPad API",
    description="Password-Based Private Photo and Video Storage System",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


class VaultPasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=4096)


@app.get("/")
async def home():
    return {
        "message": "Welcome to CodedPad API",
        "status": "Running"
    }


@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "application": "CodedPad"
    }


@app.post("/api/vault/open")
def open_vault(
    request: VaultPasswordRequest,
    db: Session = Depends(get_db)
):
    return open_or_create_vault(request.password, db)


@app.get("/api/vault/me")
def current_vault(
    session: VaultSession = Depends(get_active_session)
):
    return {
        "message": "Vault access verified.",
        "vault_id": session.vault_id,
        "status": "unlocked",
        "expires_at": session.expires_at.isoformat()
    }


@app.post("/api/vault/close")
def close_vault(
    session: VaultSession = Depends(get_active_session),
    db: Session = Depends(get_db)
):
    db.delete(session)
    db.commit()

    return {
        "message": "Vault locked successfully.",
        "status": "locked"
    }


# Upload a photo or video
@app.post("/api/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    session: VaultSession = Depends(get_active_session),
    db: Session = Depends(get_db)
):
    encryption_key = get_session_encryption_key(session)

    saved = await save_encrypted_file(
        file,
        session.vault_id,
        encryption_key
    )

    record = StoredFile(
        vault_id=session.vault_id,
        **saved
    )

    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception:
        db.rollback()

        from app.file_manager import delete_stored_file

        # Remove the physical file if metadata saving fails
        delete_stored_file(record)
        raise HTTPException(
            500,
            "File metadata could not be saved."
        )
    finally:
        await file.close()

    return {
        "message": "File uploaded and encrypted successfully.",
        "file": {
            "id": record.id,
            "name": record.original_name,
            "type": record.file_type,
            "size": record.file_size,
            "created_at": record.created_at.isoformat()
        }
    }


# List files belonging only to the unlocked vault
@app.get("/api/files")
def list_files(
    session: VaultSession = Depends(get_active_session),
    db: Session = Depends(get_db)
):
    records = db.query(StoredFile).filter(
        StoredFile.vault_id == session.vault_id
    ).order_by(
        StoredFile.created_at.desc()
    ).all()

    return {
        "files": [
            {
                "id": item.id,
                "name": item.original_name,
                "type": item.file_type,
                "mime_type": item.mime_type,
                "size": item.file_size,
                "created_at": item.created_at.isoformat()
            }
            for item in records
        ]
    }


# View or download a decrypted file
@app.get("/api/files/{file_id}")
def view_file(
    file_id: int,
    session: VaultSession = Depends(get_active_session),
    db: Session = Depends(get_db)
):
    record = db.query(StoredFile).filter(
        StoredFile.id == file_id,
        StoredFile.vault_id == session.vault_id
    ).first()

    if not record:
        raise HTTPException(
            404,
            "File not found in this vault."
        )

    encryption_key = get_session_encryption_key(session)

    content = read_encrypted_file(
        record,
        encryption_key
    )

    safe_name = quote(record.original_name)

    return Response(
        content=content,
        media_type=record.mime_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{safe_name}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store"
        }
    )
