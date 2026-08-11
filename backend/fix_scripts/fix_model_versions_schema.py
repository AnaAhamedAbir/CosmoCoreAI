from sqlalchemy import create_engine, text
from app.core.config import settings

def fix_schema():
    print("Starting schema fix for model_versions...")
    engine = create_engine(settings.DATABASE_URL)
    with engine.connect() as conn:
        for column in ['accuracy', 'f1_score', 'latency']:
            result = conn.execute(text(
                f"SELECT column_name FROM information_schema.columns WHERE table_name='model_versions' AND column_name='{column}';"
            ))
            if not result.fetchone():
                print(f"Adding '{column}' column...")
                conn.execute(text(f"ALTER TABLE model_versions ADD COLUMN {column} FLOAT;"))
                conn.commit()
                print(f"'{column}' column added.")
            else:
                print(f"'{column}' column already exists.")
            
    print("Schema fix complete.")

if __name__ == "__main__":
    fix_schema()
