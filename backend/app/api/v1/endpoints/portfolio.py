from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from app.api import deps
from app import crud, models
from app.core import security
from app.core.redis import redis_manager
from app.services.websocket_manager import manager
from app.services.portfolio_price_service import portfolio_price_service
from app.services.exchange_pool import get_or_create_exchange
from app.services.ccxt_service import ccxt_service
import ccxt.async_support as ccxt
import httpx
import json
import logging
import asyncio
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)

router = APIRouter()

STABLE_COINS = {"USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD"}
PORTFOLIO_CACHE_TTL = 30  # seconds
PRICE_CACHE_TTL = 15      # seconds

_http_client: Optional[httpx.AsyncClient] = None
_inflight_fetches: Dict[Tuple[int, bool], asyncio.Task] = {}


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(4.5, connect=2.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


def _safe_decrypt(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return security.decrypt_key(value).strip()
    except Exception:
        return value.strip()


async def _fetch_key_balance(
    key_id: int,
    exchange_name: str,
    enc_api_key: str,
    enc_secret: str,
    enc_passphrase: Optional[str],
) -> Tuple[str, Optional[Dict[str, float]], Optional[Any]]:
    exchange_id = exchange_name.lower()
    if exchange_id not in ccxt.exchanges:
        logger.warning(f"Exchange {exchange_id} not supported by CCXT")
        return exchange_id, None, None

    try:
        decrypted_api_key = security.decrypt_key(enc_api_key).strip()
        decrypted_secret = security.decrypt_key(enc_secret).strip()
        decrypted_passphrase = _safe_decrypt(enc_passphrase)

        api = await get_or_create_exchange(
            api_key_id=key_id,
            exchange_name=exchange_id,
            decrypted_api_key=decrypted_api_key,
            decrypted_secret=decrypted_secret,
            is_futures=False,
            passphrase=decrypted_passphrase,
            purpose="portfolio",
        )
    except Exception as init_error:
        logger.error(f"Failed to init pooled exchange for {exchange_id} (key={key_id}): {init_error}")
        return exchange_id, None, None

    try:
        balance = await asyncio.wait_for(api.fetch_balance(), timeout=8.0)
        total = balance.get("total", {}) if isinstance(balance, dict) else {}
        non_zero: Dict[str, float] = {}
        for symbol, amount in total.items():
            if isinstance(amount, (int, float)) and amount > 0:
                non_zero[symbol] = float(amount)
        return exchange_id, non_zero, api
    except Exception as e:
        logger.error(f"Error fetching balance from {exchange_id} for key {key_id}: {e}")
        return exchange_id, None, api


async def _fetch_usdt_prices(
    symbols: List[str],
    exchange_clients: Dict[str, Any],
    asset_primary_exchange: Dict[str, str],
) -> Dict[str, Tuple[float, float]]:
    """
    Fast price lookup for held non-stablecoin assets.
    Returns { symbol: (last_price, open_price_24h) } without calling ccxt.load_markets().
    """
    prices: Dict[str, Tuple[float, float]] = {}
    needed = [s for s in symbols if s not in STABLE_COINS]
    if not needed:
        return prices

    redis = redis_manager.get_redis()
    cached_prices: Dict[str, List[float]] = {}
    if redis:
        try:
            raw = await redis.get("portfolio:usdt_prices_v1")
            if raw:
                cached_prices = json.loads(raw)
                for sym in list(needed):
                    if sym in cached_prices:
                        vals = cached_prices[sym]
                        prices[sym] = (float(vals[0]), float(vals[1]))
                        needed.remove(sym)
        except Exception as e:
            logger.debug(f"Redis price cache read skipped: {e}")

    if not needed:
        return prices

    # 1. Targeted Binance 24hr ticker query using pre-warmed spot market IDs (no load_markets!)
    spot_mkts = ccxt_service._market_cache.get("binance_spot")
    client = _get_http_client()

    if spot_mkts:
        id_to_symbol: Dict[str, str] = {}
        for sym in needed:
            pair = f"{sym}/USDT"
            mkt = spot_mkts.get(pair)
            if mkt and mkt.get("id"):
                id_to_symbol[mkt["id"]] = sym

        market_ids = list(id_to_symbol.keys())
        # Chunk up to 100 symbols per Binance request
        for i in range(0, len(market_ids), 100):
            chunk = market_ids[i:i + 100]
            try:
                resp = await client.get(
                    "https://api.binance.com/api/v3/ticker/24hr",
                    params={"symbols": json.dumps(chunk, separators=(",", ":"))},
                )
                if resp.status_code == 200:
                    for item in resp.json():
                        sym = id_to_symbol.get(item.get("symbol"))
                        if sym:
                            last_p = float(item.get("lastPrice") or 0.0)
                            open_p = float(item.get("openPrice") or last_p)
                            prices[sym] = (last_p, open_p)
            except Exception as e:
                logger.warning(f"Targeted Binance ticker lookup failed: {e}")
    else:
        # Pre-warm cache not ready yet: hit lightweight REST 24hr endpoint directly (skips exchangeInfo)
        try:
            all_tickers_map: Optional[Dict[str, List[float]]] = None
            if redis:
                raw_all = await redis.get("portfolio:binance_all_24h_v1")
                if raw_all:
                    all_tickers_map = json.loads(raw_all)

            if all_tickers_map is None:
                resp = await client.get("https://api.binance.com/api/v3/ticker/24hr")
                if resp.status_code == 200:
                    all_tickers_map = {}
                    for item in resp.json():
                        s_id = item.get("symbol", "")
                        if s_id.endswith("USDT"):
                            base = s_id[:-4]
                            last_p = float(item.get("lastPrice") or 0.0)
                            open_p = float(item.get("openPrice") or last_p)
                            all_tickers_map[base] = [last_p, open_p]
                    if redis and all_tickers_map:
                        try:
                            await redis.set("portfolio:binance_all_24h_v1", json.dumps(all_tickers_map), ex=20)
                        except Exception:
                            pass

            if all_tickers_map:
                for sym in needed:
                    if sym in all_tickers_map:
                        vals = all_tickers_map[sym]
                        prices[sym] = (float(vals[0]), float(vals[1]))
        except Exception as e:
            logger.warning(f"Fallback Binance 24hr REST lookup failed: {e}")

    # 2. Fallback for assets not listed on Binance Spot (fetch from source pooled exchange in parallel)
    missing = [s for s in needed if s not in prices]
    if missing:
        async def _fetch_from_source(sym: str) -> Tuple[str, Optional[Tuple[float, float]]]:
            ex_id = asset_primary_exchange.get(sym)
            ex_client = exchange_clients.get(ex_id) if ex_id else None
            pair = f"{sym}/USDT"
            if ex_client and getattr(ex_client, "markets", None) and pair in ex_client.markets:
                try:
                    t = await asyncio.wait_for(ex_client.fetch_ticker(pair), timeout=2.5)
                    last_p = float(t.get("last") or 0.0)
                    open_p = float(t.get("open") or last_p)
                    return sym, (last_p, open_p)
                except Exception:
                    pass
            return sym, None

        fallback_results = await asyncio.gather(*[_fetch_from_source(s) for s in missing], return_exceptions=True)
        for res in fallback_results:
            if isinstance(res, tuple) and res[1] is not None:
                prices[res[0]] = res[1]

    # 3. Update Redis price cache
    if redis and prices:
        try:
            for sym, (lp, op) in prices.items():
                cached_prices[sym] = [lp, op]
            await redis.set("portfolio:usdt_prices_v1", json.dumps(cached_prices), ex=PRICE_CACHE_TTL)
        except Exception as e:
            logger.debug(f"Redis price cache write skipped: {e}")

    return prices


async def _compute_portfolio_balances(
    user_id: int,
    key_specs: List[Tuple[int, str, str, str, Optional[str]]],
) -> Dict[str, Any]:
    if not key_specs:
        return {"status": "success", "total_portfolio_value": 0.0, "assets": []}

    fetch_results = await asyncio.gather(
        *[_fetch_key_balance(*spec) for spec in key_specs],
        return_exceptions=True,
    )

    assets: Dict[str, Dict[str, Any]] = {}
    exchange_clients: Dict[str, Any] = {}
    asset_primary_exchange: Dict[str, str] = {}
    successful_exchanges = 0

    for item in fetch_results:
        if isinstance(item, Exception):
            logger.error(f"Unexpected balance fetch task error: {item}")
            continue
        exchange_id, non_zero, api_client = item
        if api_client is not None and exchange_id not in exchange_clients:
            exchange_clients[exchange_id] = api_client
        if non_zero is None:
            continue
        successful_exchanges += 1
        if not non_zero:
            continue

        for symbol, amount in non_zero.items():
            if symbol not in assets:
                assets[symbol] = {
                    "id": symbol,
                    "symbol": symbol,
                    "name": symbol,
                    "exchange": exchange_id,
                    "amount": 0.0,
                    "value": 0.0,
                    "price": 0.0,
                    "price24h": 0.0,
                    "history": [],
                    "allocations": [],
                }
                asset_primary_exchange[symbol] = exchange_id
            assets[symbol]["amount"] += amount
            assets[symbol]["allocations"].append({
                "exchange": exchange_id,
                "amount": amount,
            })

    if assets:
        price_map = await _fetch_usdt_prices(
            list(assets.keys()),
            exchange_clients=exchange_clients,
            asset_primary_exchange=asset_primary_exchange,
        )
        for symbol, data in assets.items():
            if symbol in STABLE_COINS:
                price, price24h = 1.0, 1.0
            else:
                price, price24h = price_map.get(symbol, (0.0, 0.0))

            data["price"] = price
            data["price24h"] = price24h
            data["value"] = data["amount"] * price
            data["history"] = [
                {"time": "24h ago", "value": data["amount"] * price24h},
                {"time": "12h ago", "value": data["amount"] * ((price + price24h) / 2)},
                {"time": "Now", "value": data["amount"] * price},
            ]

    total_portfolio_value = sum(item["value"] for item in assets.values())
    sorted_assets = sorted(assets.values(), key=lambda x: x["value"], reverse=True)

    payload = {
        "status": "success",
        "total_portfolio_value": round(total_portfolio_value, 2),
        "assets": sorted_assets,
    }

    redis = redis_manager.get_redis()
    if redis and successful_exchanges > 0:
        try:
            await redis.set(f"portfolio:balances:fresh:{user_id}", json.dumps(payload), ex=PORTFOLIO_CACHE_TTL)
        except Exception as e:
            logger.debug(f"Redis portfolio cache write skipped: {e}")

    return payload


@router.get("/balances")
async def get_portfolio_balances(
    force_refresh: bool = Query(False),
    current_user: models.User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    cache_key = f"portfolio:balances:fresh:{current_user.id}"
    redis = redis_manager.get_redis()

    if not force_refresh and redis:
        try:
            cached = await redis.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception as e:
            logger.debug(f"Redis portfolio cache read skipped: {e}")

    api_keys = crud.get_user_api_keys(db=db, user_id=current_user.id)
    enabled_keys = [k for k in api_keys if getattr(k, "is_enabled", True)]

    if not enabled_keys:
        return {"status": "success", "assets": [], "total_portfolio_value": 0.0}

    key_specs: List[Tuple[int, str, str, str, Optional[str]]] = [
        (k.id, k.exchange, k.api_key, k.secret_key, getattr(k, "passphrase", None))
        for k in enabled_keys
    ]

    inflight_key = (current_user.id, force_refresh)
    task = _inflight_fetches.get(inflight_key)
    if task is None or task.done():
        task = asyncio.create_task(_compute_portfolio_balances(current_user.id, key_specs))
        _inflight_fetches[inflight_key] = task
        task.add_done_callback(lambda t, k=inflight_key: _inflight_fetches.pop(k, None) if _inflight_fetches.get(k) is t else None)

    return await asyncio.shield(task)

@router.get("/fee/{key_id}")
async def get_fee(
    key_id: int,
    symbol: str,
    current_user: models.User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    key_record = crud.get_user_api_keys(db=db, user_id=current_user.id)
    key_data = next((k for k in key_record if k.id == key_id), None)
    
    if not key_data:
        raise HTTPException(status_code=404, detail="API Key not found")
        
    exchange_id = key_data.exchange.lower()
    if exchange_id not in ccxt.exchanges:
        raise HTTPException(status_code=400, detail=f"Exchange {exchange_id} not supported")
        
    exchange_class = getattr(ccxt, exchange_id)
    
    try:
        decrypted_api_key = security.decrypt_key(key_data.api_key)
        decrypted_secret = security.decrypt_key(key_data.secret_key)
        decrypted_passphrase = None
        if key_data.passphrase:
            decrypted_passphrase = security.decrypt_key(key_data.passphrase)

        exchange_config = {
            'apiKey': decrypted_api_key,
            'secret': decrypted_secret,
            'enableRateLimit': True,
        }
        if decrypted_passphrase:
            exchange_config['password'] = decrypted_passphrase
            
        api = exchange_class(exchange_config)
    except Exception as e:
        logger.error(f"Failed to decrypt keys or init exchange: {e}")
        raise HTTPException(status_code=500, detail="Failed to initialize exchange connection")

    try:
        await api.load_markets()
        
        # Determine base/quote
        parts = symbol.split('/')
        if len(parts) == 2:
            s_symbol = symbol
        else:
            s_symbol = f"{symbol}/USDT" # Fallback guess
            
        try:
            fee_info = await api.fetch_trading_fee(s_symbol)
            maker = fee_info.get('maker')
            taker = fee_info.get('taker')
            
            # Binance Promotional Zero-Fee Overrides
            if exchange_id == 'binance':
                # Binance currently has 0 Maker fee for FDUSD pairs
                if '/FDUSD' in s_symbol:
                    maker = 0.0
                    
            # If CCXT returns None, try to get from markets
            if maker is None or taker is None:
                if s_symbol in api.markets:
                    mkt = api.markets[s_symbol]
                    if maker is None: maker = mkt.get('maker')
                    if taker is None: taker = mkt.get('taker')
                    
            # Apply heuristics if STILL None (mostly for MEXC parsing failures)
            if maker is None or taker is None:
                if exchange_id == 'mexc':
                    maker = 0.0
                    taker = 0.0 if '/USDC' in s_symbol else 0.001
                else:
                    if maker is None: maker = 0.001
                    if taker is None: taker = 0.001
                    
            return {"maker": float(maker), "taker": float(taker)}
            
        except Exception as inner_e:
            logger.warning(f"fetch_trading_fee failed for {exchange_id}: {inner_e}")
            maker, taker = None, None
            if s_symbol in api.markets:
                market = api.markets[s_symbol]
                maker = market.get('maker')
                taker = market.get('taker')
                
            # Fallback heuristics
            if exchange_id == 'binance' and '/FDUSD' in s_symbol:
                maker = 0.0
                
            if maker is None or taker is None:
                if exchange_id == 'mexc':
                    maker = 0.0
                    taker = 0.0 if '/USDC' in s_symbol else 0.001
                else:
                    maker = maker if maker is not None else 0.001
                    taker = taker if taker is not None else 0.001
                    
            return {"maker": float(maker), "taker": float(taker)}
    except Exception as e:
        logger.error(f"Error fetching fee: {e}")
        return {"maker": 0.001, "taker": 0.001}
    finally:
        await api.close()

@router.websocket("/ws/prices")
async def portfolio_websocket_prices(websocket: WebSocket):
    await manager.connect(websocket, "portfolio_prices")
    try:
        # Start the price service if not already running
        await portfolio_price_service.start()
        
        while True:
            # Receive subscription message from frontend
            # Format: { "action": "subscribe", "exchanges": { "binance": ["BTC/USDT", "ETH/USDT"], "mexc": ["LINK/USDT"] } }
            data = await websocket.receive_json()
            if data.get("action") == "subscribe":
                exchanges = data.get("exchanges", {})
                portfolio_price_service.update_active_symbols(exchanges)
                logger.info(f"Updated portfolio price subscriptions: {exchanges}")
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, "portfolio_prices")
        # Optional: We could stop the service if no one is listening, 
        # but for simplicity, let it run or rely on the manager check in the loop.
    except Exception as e:
        logger.error(f"WS Portfolio Price Error: {e}")
        manager.disconnect(websocket, "portfolio_prices")
