
from app.database import Base, engine
from app import models

def initialize_database():
    print("Connecting to PostgreSQL...")

    Base.metadata.create_all(bind=engine)

    print("CodedPad database tables created successfully!")

    print("Tables:")
    for table in Base.metadata.sorted_tables:
        print(f"- {table.name}")


if __name__ == "__main__":
    initialize_database()
