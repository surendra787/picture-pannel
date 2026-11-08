
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Load environment variables from backend/.env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from .env")

# PostgreSQL connection
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True
)

# Database sessions
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for database models
Base = declarative_base()


# Provide a database session to API endpoints
def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()
