#!/usr/bin/env bash
# ==============================================================================
# CosmoQuantAI — Contabo-Safe Rolling Update Script (Zero 40-min Rebuild &
# Zero CPU/RAM Spike + Auto Frontend "Version update in progress" Banner)
# ==============================================================================
# Usage on VPS:
#   bash scripts/safe_update.sh
# ==============================================================================

set -e

COMPOSE_FILES="-f docker-compose.yml"
if [ -f docker-compose.prod.yml ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.prod.yml"
fi

set_update_flag() {
  local flag="$1"
  local msg="$2"
  local ver="${3:-live}"
  docker compose $COMPOSE_FILES exec -T backend python -c "
from app.utils import get_redis_client
r = get_redis_client()
r.set('cosmo_version_update_in_progress', '$flag', ex=1800 if '$flag' == 'true' else None)
r.set('cosmo_version_update_message', '''$msg''')
r.set('cosmo_app_version', '$ver')
" >/dev/null 2>&1 || true
}

cleanup() {
  local new_ver
  new_ver=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
  set_update_flag "false" "Update complete" "$new_ver"
}
trap cleanup EXIT

echo "1/5 Marking 'Version update in progress' banner ON in frontend..."
CUR_VER=$(git rev-parse --short HEAD 2>/dev/null || echo "live")
set_update_flag "true" "Version update in progress — active bots & monitors stay safe..." "$CUR_VER"
sleep 3

echo "2/5 Pulling latest code from Git..."
git pull

echo "3/5 Building updated Frontend UI (Nginx static bundle)..."
docker compose $COMPOSE_FILES up -d --build --no-deps frontend

echo "4/5 Rolling restart of Backend & Workers one-by-one (prevents Contabo CPU/RAM spike)..."
docker compose $COMPOSE_FILES up -d --no-build --no-deps --force-recreate backend

echo "    Waiting for backend to finish startup & AutoRecovery..."
for i in $(seq 1 40); do
  if docker compose $COMPOSE_FILES exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/system/ping', timeout=2)" >/dev/null 2>&1; then
    echo "    Backend is healthy!"
    break
  fi
  sleep 2
done

for svc in celery_worker_default celery_beat celery_worker_heavy telegram_bot; do
  echo "    Recreating $svc gently..."
  docker compose $COMPOSE_FILES up -d --no-build --no-deps --force-recreate "$svc"
  sleep 4
done

echo "5/5 Reloading edge Nginx (if running) & clearing update banner..."
docker compose $COMPOSE_FILES restart nginx >/dev/null 2>&1 || true
NEW_VER=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
set_update_flag "false" "Update complete" "$NEW_VER"
trap - EXIT

echo "✅ Safe rolling update finished (version: $NEW_VER)!"
docker compose $COMPOSE_FILES ps
