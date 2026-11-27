from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
import asyncio
import json
from app.services.god_mode_liquidation_service import god_mode_service
from app.services.liquidation_pool_engine import normalize_pool_horizon

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/bookmap-history")
async def get_bookmap_history(
    symbol: str = "BTC/USDT",
    exchange: str = "binance",
    minutes: int = 120,
):
    """
    Returns up to 2 hours of Redis/DB-persisted Bookmap L2 depth snapshots for chart scrollback.
    """
    return await god_mode_service.get_bookmap_history(
        symbol=symbol.upper(),
        exchange=(exchange or "binance").lower(),
        minutes=minutes,
    )


@router.websocket("/ws/god-mode")
async def websocket_god_mode_stream(
    websocket: WebSocket,
    symbol: str = "BTC/USDT",
    exchange: str = "binance",
    horizon: str = "24h",
):
    """
    Advanced WebSocket endpoint for the God Mode Dashboard & OrderFlow Chart.
    Supports multi-pair concurrent runners keyed by (symbol, exchange),
    dynamic multi-horizon liquidation pools (24h/3d/7d) without reconnecting,
    and sends a one-time bounded history snapshot on initial connect.
    """
    await websocket.accept()
    target_symbol = symbol.upper()
    target_exchange = (exchange or "binance").lower()
    client_horizon = [normalize_pool_horizon(horizon)]
    ws_send_lock = asyncio.Lock()
    logger.info(
        f"Client connected to God Mode Stream for {target_symbol} ({target_exchange}, horizon={client_horizon[0]})"
    )

    async def safe_send_json(payload):
        async with ws_send_lock:
            await websocket.send_json(payload)

    async def send_to_client(data):
        try:
            if data.get("symbol") == target_symbol:
                req_h = client_horizon[0]
                if data.get("pool_horizon") != req_h:
                    payload = god_mode_service.get_state_for_horizon(
                        target_symbol, exchange=target_exchange, horizon=req_h
                    )
                else:
                    payload = data
                await safe_send_json(payload)
        except (WebSocketDisconnect, RuntimeError) as e:
            logger.debug(f"Client disconnected during God Mode send: {e}")
            god_mode_service.remove_callback(send_to_client)
        except Exception as e:
            logger.debug(f"God Mode send_to_client suppressed: {e}")
            god_mode_service.remove_callback(send_to_client)

    god_mode_service.register_callback(send_to_client, symbol=target_symbol, exchange=target_exchange)
    asyncio.create_task(god_mode_service.start(target_symbol, exchange=target_exchange))
    asyncio.create_task(
        god_mode_service.ensure_horizon(target_symbol, exchange=target_exchange, horizon=client_horizon[0])
    )

    # Hydrate persisted 2-hour Bookmap history (fast Redis path <5ms, timeout-guarded) before initial snapshot
    try:
        await asyncio.wait_for(
            god_mode_service.ensure_bookmap_hydrated(target_symbol, exchange=target_exchange),
            timeout=1.5,
        )
    except Exception:
        pass

    # Send one-time ring-buffer + persisted 2h history snapshot immediately so past candles hydrate
    try:
        initial_snapshot = god_mode_service.get_initial_snapshot(
            target_symbol, exchange=target_exchange, horizon=client_horizon[0]
        )
        await safe_send_json(initial_snapshot)
    except Exception:
        pass

    try:
        while True:
            raw_msg = await websocket.receive_text()
            if not raw_msg:
                continue
            try:
                ctrl = json.loads(raw_msg)
                if isinstance(ctrl, dict) and ctrl.get("type") == "set_horizon":
                    new_h = normalize_pool_horizon(ctrl.get("horizon"))
                    if new_h != client_horizon[0]:
                        client_horizon[0] = new_h
                    updated = await god_mode_service.ensure_horizon(
                        target_symbol, exchange=target_exchange, horizon=new_h
                    )
                    await safe_send_json(updated)
            except (ValueError, TypeError):
                # Ignore plain ping/text keepalives
                pass
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from God Mode Stream ({target_symbol})")
    except Exception as e:
        logger.debug(f"God Mode WebSocket closed: {e}")
    finally:
        god_mode_service.remove_callback(send_to_client)
