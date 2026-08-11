from app.db.session import engine
from app.models.prediction_log import PredictionLog

def create_table():
    PredictionLog.__table__.create(bind=engine, checkfirst=True)
    print("PredictionLog table created successfully.")

if __name__ == "__main__":
    create_table()
