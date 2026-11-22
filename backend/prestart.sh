#! /usr/bin/env bash
set -e
set -x

# Let the DB start
python << END
import sys
import time
import psycopg2
from urllib.parse import urlparse
import os

url = urlparse(os.getenv("DATABASE_URL"))
dbname = url.path[1:]
user = url.username
password = url.password
host = url.hostname
port = url.port

while True:
    try:
        psycopg2.connect(
            dbname=dbname,
            user=user,
            password=password,
            host=host,
            port=port
        )
        break
    except psycopg2.OperationalError:
        sys.stdout.write("Waiting for database to become available...\n")
        time.sleep(1)
END

alembic upgrade head

# Install requirements ONLY when requirements.txt checksum changed (saves CPU/RAM/time on restarts)
REQ_HASH=$(sha256sum requirements.txt | awk '{print $1}')
PREV_HASH=""
if [ -f .last_req_sha256 ]; then
    PREV_HASH=$(cat .last_req_sha256)
fi
if [ "$REQ_HASH" != "$PREV_HASH" ]; then
    PIP_ROOT_USER_ACTION=ignore PYTHONWARNINGS="ignore" pip install -q -r requirements.txt
    echo "$REQ_HASH" > .last_req_sha256
else
    echo "✅ requirements.txt unchanged — skipping pip install."
fi

# Automatically sync any models in the uploads/models folder to the database
python -m scripts.sync_models
