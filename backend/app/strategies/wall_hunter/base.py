import asyncio
import json
import logging
from typing import Dict, Any, Optional

from app.strategies.wall_hunter.logger import WallHunterLogger
from app.strategies.wall_hunter.notifier import WallHunterNotifierMixin
from app.strategies.wall_hunter.listeners import WallHunterListenersMixin


class BaseWallHunterBot(WallHunterNotifierMixin, WallHunterListenersMixin):
    """
    Centralized Base Engine for WallHunter Trading Bots (Spot and Futures).
    Encapsulates shared telemetry, state management, background listeners,
    notifications, and lifecycle loops.
    """

    state_key_prefix: str = "wallhunter"

    def _normalize_symbol(self, symbol: str) -> str:
        """Normalizes symbol for robust comparison (e.g. BTC/USDT:USDT -> BTCUSDT)."""
        if not symbol:
            return ""
        base = symbol.split(":")[0] if ":" in symbol else symbol
        return base.replace("/", "").replace("-", "").upper()

    @property
    def total_realized_pnl(self):
        return getattr(self, '_total_realized_pnl', 0.0)

    @total_realized_pnl.setter
    def total_realized_pnl(self, value):
        diff = value - getattr(self, '_total_realized_pnl', 0.0)
        self._total_realized_pnl = value
        if diff != 0 and hasattr(self, 'advanced_risk_manager') and self.advanced_risk_manager:
            self.advanced_risk_manager.add_to_daily_pnl(diff)

    def _save_state(self):
        """Save active position state to Redis for recovery on restart."""
        if getattr(self, 'active_pos', None):
            prefix = getattr(self, 'state_key_prefix', 'wallhunter')
            state_key = f"{prefix}:state:{self.bot_id}"
            try:
                self.redis.set(state_key, json.dumps(self.active_pos))
                self.logger.info(f"💾 Saved state to Redis: {state_key}")
            except Exception as e:
                self.logger.warning(f"Failed to save state to Redis: {e}")

    async def _clear_state(self):
        """Clear active position state from Redis and cancel hanging orders."""
        if getattr(self, 'active_pos', None) and not getattr(self, 'is_paper_trading', False):
            # 1. Clean up known tracked orders
            order_keys = ['limit_order_id', 'sl_order_id', 'sl_limit_order_id', 'entry_order_id']
            for key in order_keys:
                order_id = self.active_pos.get(key)
                if order_id and hasattr(self, 'engine'):
                    try:
                        success = await self.engine.cancel_order(order_id)
                        if success:
                            self.logger.info(f"🧹 Cleaned up hanging order {order_id} ({key}) during state clear.")
                    except Exception:
                        pass

            # 2. Exchange-level sweep using cancel_all_orders
            try:
                ex = getattr(self, 'private_exchange', None) or getattr(self, 'exchange', None)
                if ex:
                    await ex.cancel_all_orders(self.symbol)
                    self.logger.info(f"🧹 Cancelled all open + conditional orders for {self.symbol} via cancel_all_orders.")
            except Exception as e:
                self.logger.debug(f"cancel_all_orders failed (may be normal if no orders exist): {e}")

        prefix = getattr(self, 'state_key_prefix', 'wallhunter')
        state_key = f"{prefix}:state:{self.bot_id}"
        try:
            self.redis.delete(state_key)
            self.logger.info(f"🗑️ Cleared state from Redis: {state_key}")
        except Exception as e:
            self.logger.warning(f"Failed to clear state from Redis: {e}")

    def calculate_oib(self, orderbook: Dict[str, Any], depth: int = 10) -> float:
        """
        Calculates the Orderbook Imbalance (OIB) for the top `depth` levels.
        Returns the Bid-to-Total volume ratio.
        > 0.5 means Bid volume dominates (Buy Pressure).
        < 0.5 means Ask volume dominates (Sell Pressure).
        """
        try:
            bids = orderbook.get('bids', [])[:depth]
            asks = orderbook.get('asks', [])[:depth]
            bid_vol = sum([level[1] for level in bids])
            ask_vol = sum([level[1] for level in asks])
            total_vol = bid_vol + ask_vol
            if total_vol == 0:
                return 0.5
            return bid_vol / total_vol
        except Exception as e:
            self.logger.warning(f"Error calculating OIB: {e}")
            return 0.5

    def _calculate_net_pnl(self, gross_pnl, entry_price, exit_price, amount, is_maker=False):
        """Calculates net PnL after entry and exit fee deductions."""
        entry_fee = (entry_price * amount) * getattr(self, 'taker_fee', 0.001)
        exit_fee = (exit_price * amount) * (getattr(self, 'maker_fee', 0.001) if is_maker else getattr(self, 'taker_fee', 0.001))

        net_pnl = gross_pnl - (entry_fee + exit_fee)

        self.total_gross_pnl += gross_pnl
        self.total_fees_paid += (entry_fee + exit_fee)

        if hasattr(self, 'auto_stop_manager') and self.auto_stop_manager:
            new_total_pnl = self.total_realized_pnl + net_pnl
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.auto_stop_manager.check_conditions(new_total_pnl, self))
            except RuntimeError:
                pass
        return net_pnl, entry_fee + exit_fee

    def _publish_status(self, current_price: float):
        """Publishes real-time status and telemetry to Redis for UI/Dashboard."""
        try:
            pnl_val = 0.0
            pnl_pct = 0.0
            entry_price = 0.0
            sl_price = 0.0
            tp_price = 0.0
            position = False

            if self.active_pos:
                position = True
                entry_price = self.active_pos.get('entry', 0.0)
                sl_price = self.active_pos.get('sl', 0.0)
                tp_price = self.active_pos.get('tp', 0.0)
                amount = self.active_pos.get('amount', 0.0)
                side = self.active_pos.get('side', 'long')

                is_short = (side == 'sell' or side == 'short')
                if hasattr(self, '_is_active_short'):
                    is_short = self._is_active_short()

                if is_short:
                    pnl_val = (entry_price - current_price) * amount
                    if entry_price > 0:
                        pnl_pct = ((entry_price - current_price) / entry_price) * 100
                else:
                    pnl_val = (current_price - entry_price) * amount
                    if entry_price > 0:
                        pnl_pct = ((current_price - entry_price) / entry_price) * 100

            mode_val = getattr(self, 'strategy_mode', getattr(self, 'direction', 'long'))
            trading_mode_val = getattr(self, 'trading_mode', 'spot' if not hasattr(self, 'leverage') else 'futures')

            status_payload = {
                "id": self.bot_id,
                "status": "active" if self.running else "inactive",
                "mode": mode_val,
                "trading_mode": trading_mode_val,
                "pnl": float(f"{pnl_val:.2f}"),
                "pnl_percent": float(f"{pnl_pct:.2f}"),
                "total_pnl": float(f"{self.total_realized_pnl:.2f}"),
                "total_gross_pnl": float(f"{self.total_gross_pnl:.2f}"),
                "total_fees_paid": float(f"{self.total_fees_paid:.2f}"),
                "global_tp_target": float(f"{self.auto_stop_manager.global_tp_target:.2f}") if hasattr(self, "auto_stop_manager") else 0.0,
                "total_orders": self.total_executed_orders,
                "total_wins": self.total_wins,
                "total_losses": self.total_losses,
                "total_longs": self.total_longs,
                "total_shorts": self.total_shorts,
                "price": float(f"{current_price:.10f}"),
                "position": position,
                "position_side": self.active_pos.get('side') if self.active_pos else None,
                "side": self.active_pos.get('side') if self.active_pos else None,
                "entry_price": float(f"{entry_price:.10f}"),
                "sl_price": float(f"{sl_price:.10f}") if sl_price != float('inf') else 0.0,
                "tp_price": float(f"{tp_price:.10f}"),
                "target_spread": getattr(self, 'target_spread', 0.0002),
                "vol_threshold": getattr(self, 'vol_threshold', 500000),
                "absorption_delta": float(f"{self.absorption_tracker.get_current_delta():.2f}") if hasattr(self, 'absorption_tracker') else 0.0,
                "is_absorbing": (self.absorption_tracker.is_absorption_detected('buy') or self.absorption_tracker.is_absorption_detected('sell')) if hasattr(self, 'absorption_tracker') else False
            }
            payload_str = json.dumps(status_payload)
            self.redis.publish(f"bot_status:{self.bot_id}", payload_str)
            self.redis.set(f"bot_status_cache:{self.bot_id}", payload_str)
        except Exception:
            pass

    async def start(self, api_key_record=None):
        """Starts the asynchronous bot background tasks."""
        self._init_task = asyncio.create_task(self._initialize_async(api_key_record))
        return self._init_task

    async def stop(self):
        """Gracefully stop all loops and tasks."""
        self.logger.info(f"🛑 Stopping WallHunter Engine for Bot {self.bot_id}...")
        self.running = False

        # Cancel background tasks
        tasks = [
            getattr(self, 'price_task', None),
            getattr(self, 'heartbeat_task', None),
            getattr(self, 'vpvr_task', None),
            getattr(self, 'trades_task', None),
            getattr(self, 'atr_task', None),
            getattr(self, 'liq_task', None),
            getattr(self, '_run_task', None),
            getattr(self, '_init_task', None),
        ]
        for t in tasks:
            if t and not t.done():
                t.cancel()

        # Stop tracker monitors
        trackers = [
            getattr(self, 'session_tracker', None),
            getattr(self, 'ut_listener', None),
            getattr(self, 'st_listener', None),
            getattr(self, 'wick_sr_listener', None),
            getattr(self, 'vwap_sd_listener', None),
            getattr(self, 'dual_engine_listener', None),
            getattr(self, 'ml_listener', None),
        ]
        for trk in trackers:
            if trk and hasattr(trk, 'stop_monitor'):
                try:
                    await trk.stop_monitor()
                except Exception:
                    pass

        # Close exchanges
        for ex_attr in ['public_exchange', 'private_exchange', 'exchange']:
            ex = getattr(self, ex_attr, None)
            if ex and hasattr(ex, 'close'):
                try:
                    await ex.close()
                except Exception:
                    pass

        self.logger.info(f"✅ Bot {self.bot_id} stopped successfully.")
