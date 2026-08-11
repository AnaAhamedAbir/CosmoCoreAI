import logging
from typing import Optional, Dict, Any
from app.forex.services.broker import OandaBrokerService
from app.forex.services.news import ForexNewsService

logger = logging.getLogger(__name__)

class RiskManager:
    """
    Evaluates Forex specific risks before allowing a trade.
    """
    def __init__(self, broker: OandaBrokerService):
        self.broker = broker
        self.news_service = ForexNewsService()

    async def check_spread(self, instrument: str, max_allowed_spread: float) -> bool:
        """
        Ensures the live spread is below the bot's threshold using memory cache.
        """
        pricing = self.broker.get_live_pricing(instrument)
        if not pricing:
            # Fallback to REST if stream hasn't ticked yet
            pricing = await self.broker.get_pricing_fallback(instrument)
            
        if pricing and pricing["spread_pips"] <= max_allowed_spread:
            return True
        logger.warning(f"Spread for {instrument} is too high: {pricing.get('spread_pips') if pricing else 'Unknown'} pips")
        return False

    async def check_news_filter(self) -> bool:
        """
        Checks if a high-impact news event is imminent.
        """
        is_news_coming = self.news_service.is_high_impact_news_imminent()
        if is_news_coming:
            logger.warning("High-Impact news imminent! Bot execution blocked by RiskManager.")
            return False
        return True

class ForexAlgoEngine:
    """
    The main execution engine for 100% automated Forex algorithms.
    """
    def __init__(self):
        self.broker = OandaBrokerService()
        self.risk_manager = RiskManager(self.broker)

    def calculate_units(self, lot_size: float) -> int:
        """
        Converts lot size to standard OANDA units.
        1 Standard Lot = 100,000 units.
        """
        return int(lot_size * 100000)

    async def execute_strategy_signal(self, bot_config: Dict[str, Any], signal: str) -> Optional[Dict[str, Any]]:
        """
        Called when a background strategy loop generates a BUY/SELL signal.
        """
        instrument = bot_config["pair"].replace("/", "_") # e.g., 'EUR/USD' -> 'EUR_USD'
        
        # 1. Risk Management Checks
        if bot_config.get("use_news_filter", True):
            is_safe = await self.risk_manager.check_news_filter()
            if not is_safe:
                logger.info(f"Bot {bot_config['name']} blocked by News Filter.")
                return None
                
        spread_ok = await self.risk_manager.check_spread(instrument, bot_config.get("max_spread_pips", 3.0))
        if not spread_ok:
            return None

        # 2. Position Sizing
        units = self.calculate_units(bot_config["lot_size"])
        if signal == "SELL":
            units = -units

        # 3. Execution
        logger.info(f"Executing {signal} {units} units on {instrument} for bot {bot_config['name']}")
        result = await self.broker.create_market_order(instrument, units)
        
        # In a complete implementation, we would save the trade to the database here using `ForexTrade` model.
        return result
