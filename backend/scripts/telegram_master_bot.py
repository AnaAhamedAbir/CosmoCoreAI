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

def main() -> None:
    """Start the bot."""
    token = settings.TELEGRAM_MASTER_BOT_TOKEN
    
    if not token:
        logger.error("TELEGRAM_MASTER_BOT_TOKEN is not set in the environment or config.")
        return

    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler("start", start))

    logger.info("Starting CosmoQuantAI Master Bot polling...")
    # Run the bot until the user presses Ctrl-C
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
