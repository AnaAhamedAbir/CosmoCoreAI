from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from typing import Any
import json
import asyncio
import websockets
from app.services.market_depth_service import market_depth_service
from app.services.orderbook_snapshot_service import orderbook_snapshot_service
from app.helpers.orderbook_math import calculate_dynamic_wall_threshold
from datetime import datetime

router = APIRouter()

@router.get("/heatmap", response_model=Any)
async def get_order_book_heatmap(
    symbol: str = Query(..., description="Trading pair, e.g., 'BTC/USDT'"),
    exchange: str = Query("binance", description="Exchange name, e.g., 'binance'"),
    bucket_size: float = Query(0.0, description="Price bucket size (0 = auto price-adaptive)"),
    depth: int = Query(100, description="Depth of order book to fetch")
) -> Any:
    """
    Get aggregated order book data for heatmap visualization.
    """
    try:
        data = await market_depth_service.fetch_order_book_heatmap(
            symbol=symbol,
            exchange_id=exchange,
            depth=depth,
            bucket_size=bucket_size
        )
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/heatmap/historical", response_model=Any)
async def get_historical_order_book_heatmap(
    symbol: str = Query(..., description="Trading pair, e.g., 'BTC/USDT'"),
    exchange: str = Query("binance", description="Exchange name, e.g., 'binance'"),
    start_time: str = Query(..., description="ISO formated start time string"),
    end_time: str = Query(..., description="ISO formated end time string"),
    interval: str = Query("1m", description="Interval granularity")
) -> Any:
    """
    Get historically recorded aggregated order book data.
    """
    try:
        start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
        
        data = await orderbook_snapshot_service.get_historical_snapshots(
            symbol=symbol,
            exchange=exchange,
            start_time=start_dt,
            end_time=end_dt,
            interval=interval
        )
        return {"snapshots": data}
    except ValueError as val_e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {val_e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/exchanges", response_model=list[str])
async def get_exchanges() -> Any:
    """List available exchanges."""
    return await market_depth_service.get_available_exchanges()

@router.get("/markets", response_model=list[str])
async def get_markets(
    exchange: str = Query(..., description="Exchange ID")
) -> Any:
    """List markets (symbols) for an exchange."""
    try:
        return await market_depth_service.get_exchange_markets(exchange)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/ohlcv", response_model=Any)
async def get_ohlcv(
    symbol: str = Query(..., description="Trading Pair"),
    exchange: str = Query(..., description="Exchange ID"),
    timeframe: str = Query("1h", description="Timeframe (1m, 1h, 1d)"),
    limit: int = Query(100, description="Number of candles")
) -> Any:
    """Get OHLCV data for chart."""
    try:
        return await market_depth_service.fetch_ohlcv(symbol, exchange, timeframe, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/book", response_model=Any)
async def get_raw_order_book(
    symbol: str = Query(..., description="Trading Pair"),
    exchange: str = Query(..., description="Exchange ID"),
    limit: int = Query(100, description="Depth limit")
) -> Any:
    """Get raw order book data."""
    try:
        return await market_depth_service.fetch_raw_order_book(symbol, exchange, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from app.core.redis import redis_manager
from app.services.market_data_streamer import market_data_streamer
from app.services.liquidity_absorption_service import liquidity_absorption_service
import asyncio

from app.services.oanda_streamer import oanda_streamer
from app.services.orderflow_cvd_service import orderflow_cvd_service
from app.services.l2_heatmap_recorder import l2_heatmap_recorder
from app.services.footprint_recorder import footprint_recorder


@router.get("/orderflow/cvd", response_model=Any)
async def get_orderflow_cvd(
    symbol: str = Query(..., description="Trading pair, e.g., 'BTC/USDT'"),
    exchange: str = Query("binance", description="Exchange ID"),
    interval: str = Query("1m", description="Chart timeframe"),
    limit: int = Query(500, ge=20, le=1000, description="Number of candles"),
) -> Any:
    """Institutional True-CVD series (uses Binance taker_buy_volume when available + divergence summary)."""
    try:
        return await orderflow_cvd_service.get_cvd_series(
            symbol=symbol,
            exchange_id=exchange,
            timeframe=interval,
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orderflow/heatmap-history", response_model=Any)
async def get_orderflow_heatmap_history(
    symbol: str = Query(..., description="Trading pair"),
    exchange: str = Query("binance", description="Exchange ID"),
    interval: str = Query("1m", description="Chart timeframe for exact bar alignment"),
    limit: int = Query(200, ge=10, le=500, description="Maximum aligned heatmap bars"),
) -> Any:
    """Candle-aligned L2 resting liquidity heatmap history with price-adaptive bucketing."""
    try:
        base_ex, _ = market_depth_service.normalize_exchange_id(exchange, symbol)
        if base_ex != "oanda":
            await market_data_streamer.start_streaming(base_ex, symbol)
        return await l2_heatmap_recorder.get_aligned_history(
            exchange_id=base_ex,
            symbol=symbol,
            interval=interval,
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orderflow/footprint", response_model=Any)
async def get_orderflow_footprint(
    symbol: str = Query(..., description="Trading pair"),
    exchange: str = Query("binance", description="Exchange ID"),
    interval: str = Query("1m", description="Chart timeframe"),
    limit: int = Query(120, ge=10, le=300, description="Number of real footprint candles"),
) -> Any:
    """Real trade-clustered Bid x Ask Footprint candles with POC, 300% diagonal imbalances & stacked zones."""
    try:
        base_ex, _ = market_depth_service.normalize_exchange_id(exchange, symbol)
        if base_ex != "oanda":
            await market_data_streamer.start_streaming(base_ex, symbol)
        return await footprint_recorder.get_footprint_candles(
            exchange_id=base_ex,
            symbol=symbol,
            interval=interval,
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/liquidity-sweep-absorption", response_model=Any)
async def get_liquidity_sweep_absorption(
    symbol: str = Query(..., description="Trading pair, e.g., 'BTC/USDT'"),
    exchange: str = Query("binance", description="Exchange ID"),
    interval: str = Query("1m", description="Chart timeframe"),
    limit: int = Query(350, ge=50, le=1000, description="Number of historical candles"),
    lookback: int = Query(20, ge=5, le=100, description="Swing sweep lookback bars"),
    min_absorbed_usd: float = Query(50000.0, ge=1000.0, description="Minimum notional absorbed USD"),
    window_sec: float = Query(20.0, ge=5.0, le=120.0, description="Live absorption rolling window in seconds"),
    include_historical: bool = Query(True, description="Include historical OHLCV sweep/absorption zones"),
) -> Any:
    """
    Returns both historical estimated Sweep + Absorption + Liquidity Swap zones
    and live L2 Iceberg/Absorption zones, ensuring live streaming is active.
    """
    try:
        norm_symbol = str(symbol or "").strip().upper()
        base_ex, _ = market_depth_service.normalize_exchange_id(exchange, norm_symbol)

        liquidity_absorption_service.configure_stream(
            exchange_id=base_ex,
            symbol=norm_symbol,
            min_absorbed_usd=min_absorbed_usd,
            window_sec=window_sec,
        )

        if base_ex != "oanda":
            await market_data_streamer.start_streaming(base_ex, norm_symbol)

        historical_zones = []
        if include_historical:
            candles = await market_depth_service.fetch_ohlcv(
                norm_symbol, base_ex, interval, limit, include_patterns=False
            )
            historical_zones = await asyncio.to_thread(
                liquidity_absorption_service.analyze_historical_candles,
                candles=candles,
                lookback=lookback,
                min_absorbed_usd=min_absorbed_usd,
            )

        live_zones = await liquidity_absorption_service.get_live_zones(base_ex, norm_symbol)
        return {
            "symbol": norm_symbol,
            "exchange": base_ex,
            "interval": interval,
            "historical_zones": historical_zones,
            "live_zones": live_zones,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.websocket("/ws/{exchange_id}/{symbol:path}")
async def websocket_market_depth(websocket: WebSocket, exchange_id: str, symbol: str):
    await websocket.accept()
    
    norm_symbol = str(symbol or "").strip().upper()
    base_exchange_id, internal_exchange_id = market_depth_service.normalize_exchange_id(exchange_id, norm_symbol)

    acquired_stream_key = None
    oanda_acquired = False
    is_oanda = base_exchange_id == 'oanda'
    pubsub = None
    channel_symbol = norm_symbol.replace("/", "_") if is_oanda else norm_symbol
    channel_name = f"market_depth_stream:{internal_exchange_id}:{channel_symbol}"

    try:
        redis = redis_manager.get_redis()
        if not redis:
            await websocket.close(code=1011, reason="Redis connection failed")
            return

        # Ensure background stream is running with refcount tracking inside try..finally so leaks cannot occur
        if is_oanda:
            oanda_streamer.add_symbol(norm_symbol)
            oanda_acquired = True
        else:
            acquired_stream_key = await market_data_streamer.acquire_stream(base_exchange_id, norm_symbol)

        pubsub = redis.pubsub()
        await pubsub.subscribe(channel_name)

        async def redis_listener():
            try:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        data = message["data"]
                        if isinstance(data, (bytes, bytearray)):
                            data = data.decode("utf-8", errors="ignore")
                        # Avoid json.loads on every 40Hz tick unless an error frame is present
                        if '"error"' in data:
                            try:
                                payload = json.loads(data)
                                if isinstance(payload, dict) and "error" in payload:
                                    await websocket.close(code=1008, reason=str(payload["error"]))
                                    return
                            except Exception:
                                pass
                        await websocket.send_text(data)
            except Exception:
                pass

        async def client_listener():
            try:
                while True:
                    await websocket.receive_text()
            except Exception:
                pass

        redis_task = asyncio.create_task(redis_listener())
        client_task = asyncio.create_task(client_listener())

        done, pending = await asyncio.wait(
            [redis_task, client_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
    finally:
        if oanda_acquired:
            oanda_streamer.remove_symbol(norm_symbol)
        if acquired_stream_key:
            market_data_streamer.release_stream(acquired_stream_key)
        if pubsub is not None:
            try:
                await pubsub.unsubscribe(channel_name)
                await pubsub.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass

@router.websocket("/ws/events")
async def websocket_heatmap_events(websocket: WebSocket, symbol: str = None):
    await websocket.accept()
    
    redis = redis_manager.get_redis()
    if not redis:
        await websocket.close(code=1011, reason="Redis connection failed")
        return

    target_symbol = str(symbol).strip().upper() if symbol else None
    pubsub = None
    try:
        pubsub = redis.pubsub()
        await pubsub.subscribe("heatmap_events")

        async def redis_listener():
            try:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        data = message["data"]
                        if isinstance(data, (bytes, bytearray)):
                            data = data.decode("utf-8", errors="ignore")
                        if target_symbol:
                            try:
                                payload = json.loads(data)
                                if str(payload.get("symbol", "")).strip().upper() != target_symbol:
                                    continue
                            except Exception:
                                continue
                        await websocket.send_text(data)
            except Exception:
                pass

        async def client_listener():
            try:
                while True:
                    await websocket.receive_text()
            except Exception:
                pass

        redis_task = asyncio.create_task(redis_listener())
        client_task = asyncio.create_task(client_listener())

        done, pending = await asyncio.wait(
            [redis_task, client_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
    finally:
        if pubsub is not None:
            try:
                await pubsub.unsubscribe("heatmap_events")
                await pubsub.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass

