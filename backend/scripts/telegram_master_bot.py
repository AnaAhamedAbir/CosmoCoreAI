import os
import sys
import asyncio
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

# Ensure the backend directory is in the path to import app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.notification import NotificationSettings
from app.models import User

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

# Reduce httpx polling logs spam
logging.getLogger("httpx").setLevel(logging.WARNING)

# Stream Telegram Bot logs into Sys Monitor -> Live Feed (no docker.sock needed)
try:
    from app.utils import attach_live_log_handler
    attach_live_log_handler(
        logger_names=("__main__", "app"),
        container_name="cosmo_telegram_bot",
        publish_bot_logs=False,
    )
except Exception:
    pass

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle the /start command."""
    args = context.args
    chat_id = update.effective_chat.id
    
    if not args or len(args) == 0:
        await update.message.reply_text(
            "Welcome to CosmoQuantAI Master Bot!\n\n"
            "To connect your account, please use the 'Connect Telegram' button from the web dashboard."
        )
        return

    payload = args[0]
    
    if not payload.startswith("user_"):
        await update.message.reply_text("Invalid connection link. Please try again from the dashboard.")
        return
        
    try:
        user_id = int(payload.replace("user_", ""))
    except ValueError:
        await update.message.reply_text("Invalid user ID in connection link.")
        return
        
    # Process the connection in the database
    db = SessionLocal()
    try:
        # Verify user exists
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            await update.message.reply_text("User account not found.")
            return
            
        notification_settings = db.query(NotificationSettings).filter(NotificationSettings.user_id == user_id).first()
        
        if not notification_settings:
            notification_settings = NotificationSettings(
                user_id=user_id,
                telegram_chat_id=str(chat_id),
                is_enabled=True,
                use_master_bot=True
            )
            db.add(notification_settings)
        else:
            notification_settings.telegram_chat_id = str(chat_id)
            notification_settings.is_enabled = True
            notification_settings.use_master_bot = True
            
        db.commit()
        
        await update.message.reply_text(
            f"✅ Successfully connected to CosmoQuantAI!\n\n"
            f"User: {user.full_name or user.email}\n"
            f"You will now receive alerts here."
        )
        logger.info(f"Successfully linked user {user_id} with chat_id {chat_id}")
        
    except Exception as e:
        logger.error(f"Error processing start command: {e}")
        await update.message.reply_text("An internal error occurred. Please try again later.")
    finally:
        db.close()

async def disconnect(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /disconnect, /stop, or /unlink commands from a user on Telegram."""
    chat_id = update.effective_chat.id
    db = SessionLocal()
    try:
        notification_settings = db.query(NotificationSettings).filter(
            NotificationSettings.telegram_chat_id == str(chat_id)
        ).first()

        if not notification_settings:
            await update.message.reply_text(
                "ℹ️ This Telegram chat is not currently connected to any CosmoQuantAI account."
            )
            return

        user = db.query(User).filter(User.id == notification_settings.user_id).first()
        user_name = user.full_name or user.email if user else "your account"

        notification_settings.telegram_chat_id = None
        notification_settings.telegram_bot_token = None
        db.commit()

        await update.message.reply_text(
            f"🔌 Successfully disconnected from CosmoQuantAI ({user_name})!\n\n"
            "You will no longer receive alerts in this chat.\n"
            "You can reconnect at any time from your web dashboard."
        )
        logger.info(f"Successfully unlinked telegram chat {chat_id} from user {notification_settings.user_id}")
    except Exception as e:
        logger.error(f"Error disconnecting telegram user: {e}")
        await update.message.reply_text("An internal error occurred while disconnecting. Please try again.")
    finally:
        db.close()

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Log the error and handle exceptions gracefully."""
    import httpx
    from telegram.error import NetworkError, Conflict
    
    if isinstance(context.error, Conflict):
        logger.warning(
            "⚠️ [Telegram Bot Conflict] Another instance of this bot is already active (e.g. on your VPS). "
            "Telegram allows only ONE active bot instance polling at a time per token. "
            "To stop this on local machine, run 'docker stop cosmo_telegram_bot' or set DISABLE_TELEGRAM_BOT=true in .env."
        )
    elif isinstance(context.error, (NetworkError, httpx.RemoteProtocolError, httpx.ReadTimeout)):
        logger.warning(f"⚠️ Telegram Network Error (safely ignored): {type(context.error).__name__}")
    else:
        logger.error(f"Exception while handling an update: {context.error}", exc_info=context.error)

def main() -> None:
    """Start the bot."""
    if os.getenv("DISABLE_TELEGRAM_BOT", "false").lower() in ("true", "1", "yes"):
        logger.info("Telegram Master Bot is disabled via DISABLE_TELEGRAM_BOT=true.")
        return

    token = settings.TELEGRAM_MASTER_BOT_TOKEN
    
    if not token:
        logger.error("TELEGRAM_MASTER_BOT_TOKEN is not set in the environment or config.")
        return

    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler(["disconnect", "stop", "unlink"], disconnect))
    application.add_error_handler(error_handler)

    logger.info("Starting CosmoQuantAI Master Bot polling...")
    # Run the bot until the user presses Ctrl-C
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
