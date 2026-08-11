from app.db.session import SessionLocal
from sqlalchemy import text
db = SessionLocal()
res = db.execute(text("SELECT id, status, logs FROM model_training_jobs WHERE id='train_1785995682710'")).fetchall()
print(res[0][0], res[0][1], res[0][2][-1] if res[0][2] else 'None')
db.close()
