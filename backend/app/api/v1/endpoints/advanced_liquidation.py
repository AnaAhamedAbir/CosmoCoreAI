from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
import asyncio
from app.services.god_mode_liquidation_service import god_mode_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/god-mode")
async def websocket_god_mode_stream(
    websocket: WebSocket,
    symbol: str = "BTC/USDT",
    exchange: str = "binance",
):
    """
    Advanced WebSocket endpoint for the God Mode Dashboard & OrderFlow Chart.
    Supports multi-pair concurrent runners keyed by (symbol, exchange) and
    sends a one-time bounded history snapshot on initial connect.
    """
    await websocket.accept()
    target_symbol = symbol.upper()
    target_exchange = (exchange or "binance").lower()
    logger.info(f"Client connected to God Mode Stream for {target_symbol} ({target_exchange})")

    async def send_to_client(data):
        try:
            if data.get("symbol") == target_symbol:
                await websocket.send_json(data)
        except (WebSocketDisconnect, RuntimeError) as e:
            logger.debug(f"Client disconnected during God Mode send: {e}")
            god_mode_service.remove_callback(send_to_client)
        except Exception as e:
            logger.debug(f"God Mode send_to_client suppressed: {e}")
            god_mode_service.remove_callback(send_to_client)

    god_mode_service.register_callback(send_to_client, symbol=target_symbol, exchange=target_exchange)
    asyncio.create_task(god_mode_service.start(target_symbol, exchange=target_exchange))

    # Send one-time ring-buffer history snapshot immediately so past candles hydrate
    try:
        initial_snapshot = god_mode_service.get_initial_snapshot(target_symbol, exchange=target_exchange)
        await websocket.send_json(initial_snapshot)
    except Exception:
        pass

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from God Mode Stream ({target_symbol})")
    except Exception as e:
        logger.debug(f"God Mode WebSocket closed: {e}")
    finally:
        god_mode_service.remove_callback(send_to_client)
