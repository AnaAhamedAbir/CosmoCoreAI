import asyncio
import logging

class AutoStopManager:
    """
    Modular manager to handle Bot Auto-Stop conditions like:
    1. Break-even Protection: Stops the bot if it falls back to zero PNL after being in profit.
    2. Global Take Profit: Stops the bot if overall PNL reaches a specified daily target.
    """
    def __init__(self, config: dict):
        self.enable_breakeven_stop = config.get("enable_breakeven_stop", False)
        self.global_tp_target = float(config.get("global_tp_target", 0.0))
        self.highest_pnl_reached = 0.0
        self.is_stopped = False

    async def check_conditions(self, current_net_pnl: float, bot_instance) -> bool:
        """
        Checks if auto-stop conditions are met based on the current PNL.
        If triggered, stops the bot and sends a notification.
        Returns True if bot was stopped, False otherwise.
        """
        if self.is_stopped or not bot_instance.running:
            return False

        # Update highest PNL reached
        if current_net_pnl > self.highest_pnl_reached:
            self.highest_pnl_reached = current_net_pnl

        triggered = False
        reason = ""

        # Check Condition 1: Global Take Profit
        if self.global_tp_target > 0 and current_net_pnl >= self.global_tp_target:
            triggered = True
            reason = f"🎉 Global Take Profit Hit! Target Reached: ${self.global_tp_target:.2f} (Current: ${current_net_pnl:.2f})"
        
        # Check Condition 2: Break-even Protection
        elif self.enable_breakeven_stop and self.highest_pnl_reached > 0 and current_net_pnl <= 0:
            triggered = True
            reason = f"⚠️ Break-even Protection Triggered! PNL dropped to ${current_net_pnl:.2f} after reaching ${self.highest_pnl_reached:.2f}."

        if triggered:
            self.is_stopped = True
            bot_instance.logger.warning(f"[AutoStopManager] {reason} Stopping bot {bot_instance.bot_id}...")
            
            # Stop the bot
            bot_instance.running = False
            
            # Send Telegram Notification
            msg = f"🛑 *Bot Auto-Stopped*\n{reason}"
            try:
                if hasattr(bot_instance, '_send_telegram'):
                    asyncio.create_task(bot_instance._send_telegram(msg))
            except Exception as e:
                bot_instance.logger.error(f"Failed to send Auto-Stop telegram: {e}")
                
            # Gracefully tell bot manager to stop it so UI updates
            try:
                from app.services.bot_manager import BotManager
                asyncio.create_task(BotManager().stop_bot(int(bot_instance.bot_id)))
            except Exception as e:
                bot_instance.logger.error(f"Failed to auto-stop via bot_manager: {e}")
                
            # Clear pending orders
            try:
                asyncio.create_task(bot_instance._clear_state())
            except Exception:
                pass
                
            return True
            
        return False
