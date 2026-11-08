
import os
import uuid

from pathlib import Path
from fastapi import HTTPException, UploadFile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = Path(
    os.getenv("STORAGE_DIR", "storage")
)

if not STORAGE_DIR.is_absolute():
    STORAGE_DIR = BASE_DIR / STORAGE_DIR

STORAGE_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_SIZE = int(
    os.getenv("MAX_UPLOAD_SIZE", "104857600")
)

ALLOWED_TYPES = {
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "image/gif": "image",
    "video/mp4": "video",
    "video/webm": "video",
    "video/quicktime": "video"
}


async def save_encrypted_file(
    upload: UploadFile,
    vault_id: int,
    encryption_key: bytes
):
    if not upload.filename:
        raise HTTPException(400, "Invalid filename.")

    mime_type = (upload.content_type or "").lower()

    if mime_type not in ALLOWED_TYPES:
        raise HTTPException(
            415,
            "Only JPEG, PNG, WEBP, GIF, MP4, WEBM and MOV files are allowed."
        )

    content = await upload.read(MAX_UPLOAD_SIZE + 1)

    if not content:
        raise HTTPException(400, "The selected file is empty.")

    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            413,
            "File exceeds the maximum allowed size of 100 MB."
        )

    # Basic file signature checks
    signatures = {
        "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
        "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/gif": lambda b: b.startswith((b"GIF87a", b"GIF89a")),
        "image/webp": lambda b: len(b) >= 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP",
        "video/mp4": lambda b: len(b) >= 12 and b[4:8] == b"ftyp",
        "video/quicktime": lambda b: len(b) >= 12 and b[4:8] == b"ftyp",
        "video/webm": lambda b: b.startswith(b"\x1a\x45\xdf\xa3")
    }

    if not signatures[mime_type](content):
        raise HTTPException(
            415,
            "File content does not match its declared type."
        )

    original_name = Path(upload.filename).name[:255]

    file_id = uuid.uuid4().hex
    relative_directory = Path(f"vault_{vault_id}")
    absolute_directory = STORAGE_DIR / relative_directory

    absolute_directory.mkdir(parents=True, exist_ok=True)

    relative_path = relative_directory / f"{file_id}.bin"
    absolute_path = STORAGE_DIR / relative_path

    nonce = os.urandom(12)

    encrypted_content = AESGCM(encryption_key).encrypt(
        nonce,
        content,
        f"codedpad-file-{vault_id}-{file_id}".encode()
    )

    try:
        with absolute_path.open("xb") as file:
            file.write(encrypted_content)
    except OSError:
        raise HTTPException(
            500,
            "Unable to save the encrypted file."
        )

    return {
        "original_name": original_name,
        "file_type": ALLOWED_TYPES[mime_type],
        "mime_type": mime_type,
        "storage_path": relative_path.as_posix(),
        "file_size": len(content),
        "encryption_nonce": nonce
    }


def read_encrypted_file(
    file_record,
    encryption_key: bytes
) -> bytes:
    absolute_path = (
        STORAGE_DIR / file_record.storage_path
    ).resolve()

    try:
        absolute_path.relative_to(STORAGE_DIR.resolve())
    except ValueError:
        raise HTTPException(500, "Invalid storage location.")

    if not absolute_path.is_file():
        raise HTTPException(404, "Stored file not found.")

    try:
        encrypted_content = absolute_path.read_bytes()

        return AESGCM(encryption_key).decrypt(
            file_record.encryption_nonce,
            encrypted_content,
            f"codedpad-file-{file_record.vault_id}-"
            f"{absolute_path.stem}".encode()
        )

    except Exception:
        raise HTTPException(
            500,
            "Unable to decrypt the stored file."
        )


def delete_stored_file(file_record):
    absolute_path = (
        STORAGE_DIR / file_record.storage_path
    ).resolve()

    try:
        absolute_path.relative_to(STORAGE_DIR.resolve())
    except ValueError:
        raise HTTPException(500, "Invalid storage location.")

    if absolute_path.exists():
        absolute_path.unlink()
