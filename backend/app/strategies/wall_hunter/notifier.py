import asyncio
import time
from app.db.session import SessionLocal
from app.services.notification import NotificationService


class WallHunterNotifierMixin:
    """Centralized notification methods for WallHunter bots (Telegram, Photos, Exit Alerts)."""

    async def _on_trading_session_end(self, session_name: str):
        """Callback triggered when the active trading session ends."""
        msg = f"⚠️ *Trading Session Ended*\nBot has been stopped because the {session_name} session is over.\n_Open trades (if any) are left untouched._"
        asyncio.create_task(self._send_telegram(msg))
        self.logger.warning(f"Session {session_name} ended. Stopping bot {self.bot_id} (leaving position open).")
        try:
            from app.services.bot_manager import bot_manager
            asyncio.create_task(bot_manager.stop_bot(str(self.bot_id), str(self.owner_id)))
        except Exception as e:
            self.logger.error(f"Failed to auto-stop via bot_manager: {e}")
            self.running = False

    async def _send_exit_telegram(self, title: str, filled_price: float, pnl_val: float, reason: str = ""):
        entry_time = self.active_pos.get("entry_time", time.time()) if getattr(self, "active_pos", None) else time.time()
        duration_sec = int(time.time() - entry_time)
        h = duration_sec // 3600
        m = (duration_sec % 3600) // 60
        s = duration_sec % 60
        duration_str = f"{h}hr, {m}min, {s}sec"
        mode_str = getattr(self, 'strategy_mode', getattr(self, 'direction', 'long')).capitalize()

        msg = (
            f"{title}\n"
            f"Bot Name: {getattr(self, 'bot_name', f'Bot {self.bot_id}')}\n"
            f"Bot ID: {self.bot_id}\n"
            f"Trade Types: {mode_str}\n"
            f"Trade Duration: {duration_str}\n"
            f"Pair: {self.symbol}\n"
            f"Exit Price: {filled_price:.6f}\n"
        )
        if reason:
            msg += f"Reason: {reason}\n"

        msg += f"💰 Trade PnL: ${pnl_val:.7f}\n\n"
        msg += (
            f"📊 Total PnL: ${self.total_realized_pnl:.7f}\n"
            f"🏆 Wins: {self.total_wins} | 💔 Losses: {self.total_losses}"
        )
        await self._send_telegram(msg)

    async def _send_telegram(self, msg: str):
        if not getattr(self, 'owner_id', None):
            return

        # Append Performance Summary for Exits
        if "EXIT" in msg or "Partial TP" in msg:
            total_closed = getattr(self, 'total_wins', 0) + getattr(self, 'total_losses', 0)
            pnl = getattr(self, 'total_realized_pnl', 0.0)
            gross = getattr(self, 'total_gross_pnl', 0.0)
            fees = getattr(self, 'total_fees_paid', 0.0)
            summary = (
                f"\n-------------------------\n"
                f"📊 *Bot {self.bot_id} Report:*\n"
                f"🔹 Closed Trades: {total_closed}\n"
                f"✅ Wins: {getattr(self, 'total_wins', 0)} | ❌ Losses: {getattr(self, 'total_losses', 0)}\n"
                f"💰 Total Net PnL: ${pnl:.2f}\n💰 Total Gross: ${gross:.2f}\n💸 Total Fees: ${fees:.2f}"
            )
            msg += summary
        try:
            db = SessionLocal()
            await NotificationService.send_message(db, self.owner_id, msg)
            db.close()
        except Exception as e:
            self.logger.error(f"Failed to send Telegram in WallHunterBot: {e}")

    async def _send_telegram_photo(self, photo_bytes: bytes, caption: str):
        if not getattr(self, 'owner_id', None):
            return
        try:
            db = SessionLocal()
            await NotificationService.send_photo_bytes(db, self.owner_id, photo_bytes, caption=caption)
            db.close()
        except Exception as e:
            self.logger.error(f"Error sending photo to telegram: {e}")
