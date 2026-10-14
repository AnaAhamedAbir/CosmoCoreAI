import logging
from typing import Optional

try:
    from app.core.security import decrypt_key
except ImportError:
    def decrypt_key(key):
        return key


class WallHunterLogger:
    _redis_client = None

    def __init__(self, bot_id: int):
        self.bot_id = bot_id
        self._logger = logging.getLogger("WallHunter" + str(bot_id))

    def _push_redis(self, log_type: str, message: str):
        try:
            import datetime
            import json
            import redis
            from app.core.config import settings

            if WallHunterLogger._redis_client is None:
                WallHunterLogger._redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

            r = WallHunterLogger._redis_client

            timestamp = datetime.datetime.now().strftime("%H:%M:%S")
            log_entry = {"time": timestamp, "type": log_type, "message": str(message)}
            stream_payload = {"channel": f"logs_{self.bot_id}", "data": log_entry}
            r.publish("bot_logs", json.dumps(stream_payload))
            r.publish(f"bot_logs:{self.bot_id}", json.dumps(log_entry))
            list_key = f"bot_logs_list:{self.bot_id}"
            r.rpush(list_key, json.dumps(log_entry))
            r.ltrim(list_key, -50, -1)
        except Exception:
            pass

    def info(self, msg, *args, **kwargs):
        self._logger.info(msg, *args, **kwargs)
        self._push_redis("INFO", (str(msg) % args) if args else str(msg))

    def warning(self, msg, *args, **kwargs):
        self._logger.warning(msg, *args, **kwargs)
        self._push_redis("WARNING", (str(msg) % args) if args else str(msg))

    def error(self, msg, *args, **kwargs):
        self._logger.error(msg, *args, **kwargs)
        self._push_redis("ERROR", (str(msg) % args) if args else str(msg))

    def debug(self, msg, *args, **kwargs):
        self._logger.debug(msg, *args, **kwargs)


# Alias for backwards compatibility
WallHunterFuturesLogger = WallHunterLogger
