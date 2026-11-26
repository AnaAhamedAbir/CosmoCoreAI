import logging
import time
import telegram
from telegram.request import HTTPXRequest
from sqlalchemy.orm import Session
from app.models.notification import NotificationSettings
from app.core.config import settings

import asyncio
logger = logging.getLogger(__name__)

# Telegram network timeouts (seconds) - Default fallbacks
DEFAULT_TELEGRAM_TIMEOUT = 30.0
_SUPPORTED_IN_APP_CATEGORIES = ("manual_trade", "wallhunter", "ml_training", "market_alerts")
_SETTINGS_CACHE_TTL_SEC = 30.0
# Key: (bind_id, user_id) -> (expires_ts, cached_snapshot_dict_or_None)
_NOTIFICATION_SETTINGS_CACHE = {}


def _make_bot(token: str) -> telegram.Bot:
    """
    Create a Telegram Bot with explicit timeouts to avoid indefinite hangs.
    Uses HTTPXRequest so we can set connection / read / write timeouts.
    """
    timeout = getattr(settings, "TELEGRAM_TIMEOUT", DEFAULT_TELEGRAM_TIMEOUT)
    
    request = HTTPXRequest(
        connect_timeout=timeout,
        read_timeout=timeout,
        write_timeout=timeout,
    )
    return telegram.Bot(token=token, request=request)


class NotificationService:
    @staticmethod
    def invalidate_user_cache(user_id: int) -> None:
        uid = int(user_id)
        for k in [key for key in list(_NOTIFICATION_SETTINGS_CACHE.keys()) if key[1] == uid]:
            _NOTIFICATION_SETTINGS_CACHE.pop(k, None)

    @staticmethod
    def _get_cached_user_settings(db: Session, user_id: int, alert_type: str = None):
        bind_id = id(db.get_bind()) if hasattr(db, "get_bind") else id(db)
        cache_key = (bind_id, int(user_id))
        now_ts = time.time()
        cached = _NOTIFICATION_SETTINGS_CACHE.get(cache_key)
        if cached is not None and now_ts < cached[0]:
            return cached[1]

        row = db.query(NotificationSettings).filter(
            NotificationSettings.user_id == user_id
        ).first()
        if not row:
            snap = None
        else:
            snap = {
                "is_enabled": bool(row.is_enabled),
                "use_master_bot": bool(getattr(row, "use_master_bot", False)),
                "telegram_bot_token": row.telegram_bot_token,
                "telegram_chat_id": row.telegram_chat_id,
                "alerts": {
                    col: bool(getattr(row, col, True))
                    for col in ("alert_manual_trade", "alert_wallhunter", "alert_ml_training", "alert_server_errors")
                },
                "row": row,
            }
        if len(_NOTIFICATION_SETTINGS_CACHE) > 512:
            _NOTIFICATION_SETTINGS_CACHE.clear()
        _NOTIFICATION_SETTINGS_CACHE[cache_key] = (now_ts + _SETTINGS_CACHE_TTL_SEC, snap)
        return snap

    @staticmethod
    async def send_message(
        db: Session,
        user_id: int,
        message: str,
        parse_mode: str = None,
        alert_type: str = None,
        skip_in_app: bool = False,
        in_app_category: str = None,
    ):
        """
        Sends a Telegram message to the user if notifications are enabled.
        """
        if not skip_in_app and (in_app_category in _SUPPORTED_IN_APP_CATEGORIES or alert_type == "alert_manual_trade"):
            try:
                from app.services.system_notification_service import SystemNotificationService
                await SystemNotificationService.emit_from_telegram(
                    user_id=user_id,
                    category=in_app_category or "manual_trade",
                    raw_message=message,
                )
            except Exception as in_app_err:
                logger.debug(f"[SysNotif] In-app emit skipped (non-fatal): {in_app_err}")

        try:
            snap = NotificationService._get_cached_user_settings(db, user_id, alert_type=alert_type)

            if not snap:
                logger.info(f"Notification settings not found for user {user_id}")
                return

            if not snap["is_enabled"]:
                logger.info(f"Notifications disabled for user {user_id}")
                return

            if alert_type:
                row_obj = snap.get("row")
                if alert_type in snap["alerts"]:
                    allowed = snap["alerts"][alert_type]
                elif row_obj is not None and hasattr(row_obj, alert_type):
                    allowed = bool(getattr(row_obj, alert_type, True))
                else:
                    allowed = True
                if not allowed:
                    logger.info(f"Notification alert_type '{alert_type}' is disabled for user {user_id}")
                    return

            if snap["use_master_bot"]:
                from app.core.config import settings as app_settings
                bot_token = app_settings.TELEGRAM_MASTER_BOT_TOKEN
            else:
                bot_token = snap["telegram_bot_token"]
                
            chat_id = snap["telegram_chat_id"]

            if not bot_token or not chat_id:
                logger.warning(f"Incomplete Telegram credentials for user {user_id}")
                return

            bot = _make_bot(bot_token)
            
            # Implementation of the "Better than before" Retry Logic
            # Telegram message length limit is 4096. We truncate at 4000 to be safe.
            if len(message) > 4000:
                message = message[:4000] + "\n...[Message Truncated]"

            retries = 1
            while retries >= 0:
                try:
                    await bot.send_message(chat_id=chat_id, text=message, parse_mode=parse_mode)
                    logger.info(f"Notification sent to user {user_id}")
                    break 
                except telegram.error.BadRequest as br:
                    if parse_mode:
                        logger.warning(f"Telegram parse_mode '{parse_mode}' error ({br}), retrying as plain text...")
                        await bot.send_message(chat_id=chat_id, text=message, parse_mode=None)
                        logger.info(f"Notification sent to user {user_id} (fallback plain text)")
                        break
                    raise
                except telegram.error.TimedOut:
                    if retries > 0:
                        logger.warning(f"Telegram timeout for user {user_id}. Retrying in 2s...")
                        await asyncio.sleep(2)
                        retries -= 1
                        continue
                    else:
                        raise # Re-raise for the outer except block to handle final failure
        
        except telegram.error.TimedOut:
            # Network is slow / Telegram API unreachable — log at WARNING, not ERROR,
            # to avoid triggering the log-monitor alert loop.
            logger.warning(
                f"[TelegramNotify] Timed out sending to user {user_id} — "
                "check network connectivity to api.telegram.org"
            )
        except telegram.error.NetworkError as e:
            logger.warning(f"[TelegramNotify] Network error for user {user_id}: {e}")
        except Exception as e:
            logger.error(f"[TelegramNotify] Unexpected error for user {user_id}: {e}")

    @staticmethod
    async def send_voice(
        db: Session,
        user_id: int,
        voice_path: str,
        caption: str = None,
        parse_mode: str = None,
        skip_in_app: bool = False,
        in_app_category: str = None,
    ):
        """
        Sends an audio/voice file to the user via Telegram.
        """
        if not skip_in_app and in_app_category in _SUPPORTED_IN_APP_CATEGORIES and caption:
            try:
                from app.services.system_notification_service import SystemNotificationService
                await SystemNotificationService.emit_from_telegram(
                    user_id=user_id,
                    category=in_app_category,
                    raw_message=caption,
                )
            except Exception as in_app_err:
                logger.debug(f"[SysNotif] Voice in-app emit skipped (non-fatal): {in_app_err}")

        try:
            settings = db.query(NotificationSettings).filter(
                NotificationSettings.user_id == user_id
            ).first()

            if not settings or not settings.is_enabled:
                return

            if getattr(settings, 'use_master_bot', False):
                from app.core.config import settings as app_settings
                bot_token = app_settings.TELEGRAM_MASTER_BOT_TOKEN
            else:
                bot_token = settings.telegram_bot_token
                
            chat_id = settings.telegram_chat_id
            
            if not bot_token or not chat_id:
                return

            bot = _make_bot(bot_token)
            
            with open(voice_path, 'rb') as voice_file:
                await bot.send_voice(
                    chat_id=chat_id, 
                    voice=voice_file, 
                    caption=caption, 
                    parse_mode=parse_mode
                )
                logger.info(f"Voice note sent to user {user_id}")
        except Exception as e:
            logger.error(f"[TelegramNotify] Failed to send voice message to {user_id}: {e}")

    @staticmethod
    async def send_photo(db: Session, user_id: int, photo_url: str, caption: str = None, parse_mode: str = None):
        """
        Sends a photo to the user via Telegram.
        Downloads the image first to bypass CDN restrictions (e.g. Google's lh3 CDN).
        """
        try:
            settings = db.query(NotificationSettings).filter(
                NotificationSettings.user_id == user_id
            ).first()

            if not settings or not settings.is_enabled:
                return

            if getattr(settings, 'use_master_bot', False):
                from app.core.config import settings as app_settings
                bot_token = app_settings.TELEGRAM_MASTER_BOT_TOKEN
            else:
                bot_token = settings.telegram_bot_token
                
            chat_id = settings.telegram_chat_id
            
            if not bot_token or not chat_id:
                return

            bot = _make_bot(bot_token)

            # Download image ourselves to avoid CDN/auth issues with Telegram directly fetching
            import httpx, io
            async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as hc:
                img_resp = await hc.get(photo_url)
                img_resp.raise_for_status()
                img_bytes = io.BytesIO(img_resp.content)
                img_bytes.name = "thumbnail.jpg"

            await bot.send_photo(
                chat_id=chat_id,
                photo=img_bytes,
                caption=caption,
                parse_mode=parse_mode
            )
            logger.info(f"Photo notification sent to user {user_id}")
        except Exception as e:
            logger.warning(f"[TelegramNotify] Could not send photo to {user_id}: {e} — falling back to text.")
            raise  # Let caller fall back to text

    @staticmethod
    async def send_photo_bytes(
        db: Session,
        user_id: int,
        photo_bytes: bytes,
        caption: str = None,
        parse_mode: str = None,
        skip_in_app: bool = False,
        in_app_category: str = None,
    ):
        """
        Sends a photo from memory (bytes) to the user via Telegram.
        """
        if not skip_in_app and in_app_category in _SUPPORTED_IN_APP_CATEGORIES and caption:
            try:
                from app.services.system_notification_service import SystemNotificationService
                await SystemNotificationService.emit_from_telegram(
                    user_id=user_id,
                    category=in_app_category,
                    raw_message=caption,
                )
            except Exception as in_app_err:
                logger.debug(f"[SysNotif] Photo bytes in-app emit skipped (non-fatal): {in_app_err}")

        try:
            settings = db.query(NotificationSettings).filter(
                NotificationSettings.user_id == user_id
            ).first()

            if not settings or not settings.is_enabled:
                return

            if getattr(settings, 'use_master_bot', False):
                from app.core.config import settings as app_settings
                bot_token = app_settings.TELEGRAM_MASTER_BOT_TOKEN
            else:
                bot_token = settings.telegram_bot_token
                
            chat_id = settings.telegram_chat_id
            
            if not bot_token or not chat_id:
                return

            bot = _make_bot(bot_token)
            
            import io
            img_io = io.BytesIO(photo_bytes)
            img_io.name = "chart.png"

            await bot.send_photo(
                chat_id=chat_id,
                photo=img_io,
                caption=caption,
                parse_mode=parse_mode
            )
            logger.info(f"Photo bytes notification sent to user {user_id}")
        except Exception as e:
            logger.warning(f"[TelegramNotify] Could not send photo to {user_id}: {e} — falling back to text.")
            if caption:
                await NotificationService.send_message(db, user_id, caption, parse_mode, skip_in_app=True)

    @staticmethod
    async def force_send_message(bot_token: str, chat_id: str, message: str):
        """
        Sends a test message using provided credentials.
        """
        try:
            bot = _make_bot(bot_token)
            await bot.send_message(chat_id=chat_id, text=message)
            return True, "Message sent successfully"
        except telegram.error.TimedOut:
            return False, "Request timed out — check your network or Telegram API access."
        except Exception as e:
            return False, str(e)

    @staticmethod
    async def broadcast_admin_alert(db: Session, message: str, parse_mode: str = None):
        """
        Sends a system-level broadcast alert to all users with active Telegram notifications.
        Useful for background tasks (Auto-Archiver, System Errors).
        """
        try:
            from sqlalchemy import or_
            active_users = db.query(NotificationSettings).filter(
                NotificationSettings.is_enabled == True,
                NotificationSettings.telegram_chat_id != None,
                NotificationSettings.telegram_chat_id != "",
                or_(
                    NotificationSettings.telegram_bot_token != None,
                    NotificationSettings.use_master_bot == True
                )
            ).all()

            for settings in active_users:
                try:
                    if getattr(settings, 'use_master_bot', False):
                        from app.core.config import settings as app_settings
                        bot_token = app_settings.TELEGRAM_MASTER_BOT_TOKEN
                    else:
                        bot_token = settings.telegram_bot_token
                        
                    if not bot_token:
                        continue
                        
                    bot = _make_bot(bot_token)
                    await bot.send_message(chat_id=settings.telegram_chat_id, text=message, parse_mode=parse_mode)
                    logger.info(f"Broadcast alert sent to user {settings.user_id}")
                except Exception as e:
                    logger.error(f"[TelegramNotify] Failed to broadcast to user {settings.user_id}: {e}")
        except Exception as e:
            logger.error(f"[TelegramNotify] Broadcast failed: {e}")

    @staticmethod
    def broadcast_admin_alert_sync(db: Session, message: str, parse_mode: str = None):
        """
        Synchronous wrapper for broadcast_admin_alert.
        """
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(
                NotificationService.broadcast_admin_alert(db, message, parse_mode)
            )
        finally:
            loop.close()
