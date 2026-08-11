import sqlite3
import json

conn = sqlite3.connect('bot_database.db')
c = conn.cursor()
c.execute("SELECT config FROM model_training_jobs WHERE job_id = 'train_1784040633562'")
res = c.fetchone()
if res:
    config = json.loads(res[0])
    features = config.get('features', [])
    print(f"Features in config ({len(features)}):", features)
else:
    print("Job not found")
