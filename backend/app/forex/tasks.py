import logging
import asyncio
from app.celery_app import celery_app
from app.db.session import SessionLocal
from app.forex import models
from app.forex.services.engine import ForexAlgoEngine

logger = logging.getLogger(__name__)
engine = ForexAlgoEngine()

@celery_app.task(name="run_forex_bots_task")
def run_forex_bots_task():
    """
    Background job that runs periodically (e.g., every minute) to execute automated logic for active Forex bots.
    """
    db = SessionLocal()
    try:
        active_bots = db.query(models.ForexBot).filter(models.ForexBot.status == "active").all()
        if not active_bots:
            logger.info("No active Forex bots running.")
            return "No active bots."
            
        logger.info(f"Running algo loop for {len(active_bots)} active Forex bots.")
        
        # Asyncio run loop for async broker calls within a sync Celery task
        loop = asyncio.get_event_loop()
        
        for bot in active_bots:
            # Prepare bot config
            bot_config = {
                "id": bot.id,
                "name": bot.name,
                "pair": bot.pair,
                "lot_size": bot.lot_size,
                "use_news_filter": bot.use_news_filter,
                "max_spread_pips": bot.max_spread_pips,
                "strategy": bot.strategy
            }
            
            instrument = bot.pair.replace("/", "_")
            
            # Step 1: Fetch Historical Candles for Analysis
            candles = loop.run_until_complete(engine.broker.get_candles(instrument=instrument, count=50))
            if not candles:
                logger.warning(f"Could not fetch candles for bot {bot.name}. Skipping cycle.")
                continue
                
            # Step 2: Very Basic Moving Average Strategy Logic (Mock placeholder)
            # In production, we'd use Pandas-TA on `candles`
            close_prices = [c["close"] for c in candles]
            current_price = close_prices[-1]
            avg_price = sum(close_prices) / len(close_prices)
            
            signal = None
            if current_price > avg_price * 1.001:
                signal = "SELL" # Mean reversion strategy
            elif current_price < avg_price * 0.999:
                signal = "BUY"
                
            # Step 3: Execute Signal via Engine
            if signal:
                logger.info(f"Generated {signal} signal for {bot.name}")
                result = loop.run_until_complete(engine.execute_strategy_signal(bot_config, signal))
                if result:
                    logger.info(f"Trade successful: {result}")
                    
        return f"Processed {len(active_bots)} bots successfully."
        
    except Exception as e:
        logger.error(f"Error in run_forex_bots_task: {str(e)}")
        db.rollback()
        return str(e)
    finally:
        db.close()
