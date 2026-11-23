from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
import asyncio
import time
from app.services.liquidation_service import liquidation_service, canonical_pair_symbol

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/candles")
async def get_candles(
    symbol: str,
    interval: str = "15m",
    limit: int = 50,
    exchange: str = "binance",
):
    """
    Get historical candle data (klines) for the given symbol and exchange.
    """
    return await liquidation_service.get_klines(symbol, interval, limit, exchange_id=exchange)


@router.websocket("/ws/stream")
async def websocket_liquidation_stream(
    websocket: WebSocket,
    exchange: str = "binance",
    symbol: str = "BTC/USDT",
):
    """
    WebSocket endpoint to stream real-time liquidation data.
    args:
        exchange: The exchange name (e.g., 'binance')
        symbol: The trading pair symbol to subscribe to (e.g., 'BTC/USDT' or 'ACE/USDT:USDT').
    """
    await websocket.accept()
    logger.info(f"Client connected to Liquidation Stream for {exchange}:{symbol}")

    target_symbol = canonical_pair_symbol(symbol)
    target_exchange = (exchange or "binance").lower().strip()

    # Subscribe to the requested exchange and symbol
    subscribed = await liquidation_service.subscribe(target_exchange, target_symbol)

    # Immediately send initial Oracle price snapshot so UI does not stay blank or show stale pair price
    try:
        initial_price = await liquidation_service.get_latest_price(target_exchange, target_symbol)
        if initial_price > 0:
            await websocket.send_json({
                "event_type": "price_sync",
                "exchange": target_exchange,
                "symbol": target_symbol,
                "price": initial_price,
                "timestamp": int(time.time() * 1000),
            })
    except Exception as e:
        logger.debug(f"Initial price sync skipped for {target_exchange}:{target_symbol}: {e}")

    async def send_to_client(data):
        try:
            event_sym = canonical_pair_symbol(str(data.get("symbol") or ""))
            event_ex = str(data.get("exchange") or "").lower().strip()
            if event_sym == target_symbol and event_ex == target_exchange:
                await websocket.send_json(data)
        except (WebSocketDisconnect, RuntimeError) as e:
            logger.debug(f"Client disconnected during Liquidation send: {e}")
            liquidation_service.remove_callback(send_to_client)
        except Exception as e:
            logger.debug(f"Liquidation send_to_client suppressed: {e}")
            liquidation_service.remove_callback(send_to_client)

    liquidation_service.register_callback(send_to_client)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from Liquidation Stream ({target_exchange}:{target_symbol})")
    except Exception as e:
        logger.debug(f"Liquidation WebSocket closed: {e}")
    finally:
        liquidation_service.remove_callback(send_to_client)
        if subscribed:
            await liquidation_service.unsubscribe(target_exchange, target_symbol)
