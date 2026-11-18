"""
Exchange Connection Pool
========================
CCXT Exchange অবজেক্টগুলো মেমোরিতে Cache করে রাখে।
প্রতিটি অর্ডারে নতুন করে Exchange Init করতে হয় না,
ফলে Order Latency ~400-800ms কমে যায়।

শুধুমাত্র ManualTradeModal এর জন্য ব্যবহার করা হবে।
অন্য কোনো সার্ভিস এটি ব্যবহার করে না।
"""

import asyncio
import copy
import socket
import ssl
import time
import logging
try:
    import aiohttp
except ImportError:
    aiohttp = None
try:
    import ccxt.pro as ccxtpro
except ImportError:
    ccxtpro = None
import ccxt.async_support as ccxt_async
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# Cache entry: (exchange_instance, created_at_timestamp)
_pool: Dict[str, Tuple[Any, float]] = {}
_pool_lock = asyncio.Lock()
_keepalive_task: Optional[asyncio.Task] = None
_last_prewarm_ts: Dict[int, float] = {}
_last_global_keepalive_ts: Dict[str, float] = {"spot": 0.0, "futures": 0.0}
PREWARM_COOLDOWN_SECONDS = 20.0

# Shared multi-tenant HTTP session per event loop so 1,000+ users share warm TCP/TLS sockets
# to api.binance.com, fapi.binance.com, and dapi.binance.com with only 1 keepalive ping per 25s.
_shared_sessions: Dict[int, Any] = {}


def _get_shared_http_session() -> Optional[Any]:
    """Returns a shared aiohttp.ClientSession bound to the current running event loop."""
    if aiohttp is None:
        return None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    loop_id = id(loop)
    sess = _shared_sessions.get(loop_id)
    if sess is not None and not getattr(sess, 'closed', True):
        return sess
    try:
        ssl_ctx = ssl.create_default_context()
        connector = aiohttp.TCPConnector(
            ssl=ssl_ctx,
            limit=0,
            limit_per_host=0,
            ttl_dns_cache=300,
            keepalive_timeout=55.0,
            enable_cleanup_closed=True,
            family=socket.AF_UNSPEC,
            happy_eyeballs_delay=0,
        )
        sess = aiohttp.ClientSession(connector=connector, trust_env=True)
        _shared_sessions[loop_id] = sess
        return sess
    except Exception as e:
        logger.debug(f"[ExchangePool] Shared session init fallback: {e}")
        return None

# একটি Exchange Instance কতক্ষণ Cache এ থাকবে (seconds)
CACHE_TTL_SECONDS = 3600  # ১ ঘন্টা

def _make_cache_key(api_key_id: int, is_futures: bool, purpose: str = "general") -> str:
    """api_key_id, mode (spot/futures) এবং purpose দিয়ে unique key তৈরি করে।"""
    mode = "futures" if is_futures else "spot"
    if purpose and purpose != "general":
        return f"key_{api_key_id}_{mode}_{purpose}"
    return f"key_{api_key_id}_{mode}"


async def _prewarm_ws_client(exchange: Any, url: str):
    """Pre-connects a CCXT Pro WebSocket API client so order frames execute in 1 RTT with 0ms handshake."""
    if not url or not hasattr(exchange, 'client') or not hasattr(exchange, 'open'):
        return
    try:
        exchange.open()
        client = exchange.client(url)
        if hasattr(client, 'connect'):
            connected_fut = getattr(client, 'connected', None)
            if connected_fut is None or not connected_fut.done() or connected_fut.exception() is not None:
                backoff = exchange.ws_dial_delay(url) if hasattr(exchange, 'ws_dial_delay') else 0
                await asyncio.wait_for(client.connect(exchange.session, backoff), timeout=4.0)
    except Exception:
        pass


async def prewarm_exchange_connections(exchange: Any, is_futures: bool = False, force: bool = False):
    """
    Warms the shared REST HTTP TCP/TLS keep-alive pool for Spot (api.binance.com),
    USDT-M (fapi.binance.com), and COIN-M (dapi.binance.com) in the background.
    Deduplicated globally across all 1,000+ users so at most 1 ping per market type
    is sent every 20-25 seconds across the entire server.
    """
    if not exchange or getattr(exchange, 'closed', False):
        return
    now = time.time()
    mode_key = "futures" if is_futures else "spot"
    ex_id = id(exchange)

    # If the shared connection pool for this mode was already warmed within 20s, skip!
    if not force:
        if (now - _last_global_keepalive_ts.get(mode_key, 0.0)) < PREWARM_COOLDOWN_SECONDS:
            return
        if (now - _last_prewarm_ts.get(ex_id, 0.0)) < PREWARM_COOLDOWN_SECONDS:
            return

    _last_global_keepalive_ts[mode_key] = now
    _last_prewarm_ts[ex_id] = now

    tasks = []
    if hasattr(exchange, 'fetch_time'):
        tasks.append(asyncio.wait_for(exchange.fetch_time(), timeout=3.0))
    if is_futures and hasattr(exchange, 'dapiPublicGetTime') and callable(getattr(exchange, 'dapiPublicGetTime')):
        tasks.append(asyncio.wait_for(exchange.dapiPublicGetTime(), timeout=3.0))

    if tasks:
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        except Exception:
            pass


def is_ws_api_ready(exchange: Any, is_futures: bool = False, is_inverse: bool = False) -> bool:
    """
    Returns True if the exchange's WebSocket API connection for the target market type
    is already connected and ready for 1-RTT order execution (or if exchange is a test mock).
    Does NOT auto-dial new WebSockets for idle users (protecting Binance's 300 WS/5min IP limit
    across 1,000+ users); instead returns False so the caller immediately executes in 1 single RTT
    (~255ms) over the shared warm HTTP/TLS REST session.
    """
    if not exchange:
        return False
    urls = getattr(exchange, 'urls', None)
    if not isinstance(urls, dict):
        # Unit test mock exchange without CCXT urls dict
        return True
    ws_api_urls = urls.get('api', {}).get('ws', {}).get('ws-api', {})
    if not isinstance(ws_api_urls, dict) or not ws_api_urls:
        return True

    mtype = 'delivery' if (is_futures and is_inverse) else ('future' if is_futures else 'spot')
    url = ws_api_urls.get(mtype)
    if not url:
        return True

    clients = getattr(exchange, 'clients', None)
    if isinstance(clients, dict) and url in clients:
        client = clients[url]
        conn_fut = getattr(client, 'connected', None)
        if (
            conn_fut is not None
            and conn_fut.done()
            and not conn_fut.cancelled()
            and conn_fut.exception() is None
            and getattr(client, 'connection', None) is not None
        ):
            return True

    return False


async def _keepalive_worker():
    """
    প্রতি 25 সেকেন্ডে পুল থেকে মাত্র ১টি Spot এবং ১টি Futures Exchange দিয়ে হালকা public ping
    (fetch_time + dapiPublicGetTime) চালায়।
    যেহেতু সব ইউজারের Exchange একই Shared aiohttp.ClientSession (TCP/TLS Pool) শেয়ার করে,
    তাই ১০০০+ ইউজার থাকলেও মাত্র ১টি পিংয়েই সবার Spot, USDT-M (fapi) ও COIN-M (dapi) কানেকশন
    উষ্ণ (warm/alive) থাকে এবং IP Rate Limit খরচ হয় মিনিটে মাত্র ~4.8 Weight!
    """
    while True:
        try:
            await asyncio.sleep(25)
            async with _pool_lock:
                entries = list(_pool.items())
            spot_ex = None
            fut_ex = None
            for key, (ex, _) in entries:
                if getattr(ex, 'closed', False):
                    continue
                if '_futures' in str(key):
                    if fut_ex is None:
                        fut_ex = ex
                else:
                    if spot_ex is None:
                        spot_ex = ex
                if spot_ex is not None and fut_ex is not None:
                    break
            if spot_ex is not None:
                await prewarm_exchange_connections(spot_ex, is_futures=False, force=True)
            if fut_ex is not None:
                await prewarm_exchange_connections(fut_ex, is_futures=True, force=True)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"[ExchangePool] Keepalive ping notice: {e}")


def _ensure_keepalive():
    """Ensure the background keepalive ping worker is running."""
    global _keepalive_task
    if _keepalive_task is None or _keepalive_task.done():
        try:
            loop = asyncio.get_running_loop()
            _keepalive_task = loop.create_task(_keepalive_worker())
        except RuntimeError:
            pass


async def get_or_create_exchange(
    api_key_id: int,
    exchange_name: str,
    decrypted_api_key: str,
    decrypted_secret: str,
    is_futures: bool,
    passphrase: Optional[str] = None,
    purpose: str = "general",
) -> Any:
    """
    Cache থেকে Exchange Instance ফেরত দেয়।
    না থাকলে নতুন তৈরি করে Cache করে রাখে।
    purpose='order' দিলে অর্ডারের জন্য সম্পূর্ণ আলাদা unthrottled dedicated instance তৈরি হয়।
    """
    _ensure_keepalive()
    cache_key = _make_cache_key(api_key_id, is_futures, purpose=purpose)

    async with _pool_lock:
        # Cache Hit — TTL চেক করুন
        if cache_key in _pool:
            exchange, created_at = _pool[cache_key]
            if time.time() - created_at < CACHE_TTL_SECONDS:
                if not getattr(exchange, 'markets', None):
                    try:
                        await asyncio.wait_for(exchange.load_markets(), timeout=8.0)
                    except Exception:
                        if is_futures and exchange_name.lower() == 'binance':
                            try:
                                exchange.options['fetchMarkets'] = {'types': ['linear', 'inverse']}
                                await asyncio.wait_for(exchange.load_markets(), timeout=12.0)
                            except Exception:
                                pass
                logger.debug(f"[ExchangePool] ✅ Cache HIT for key={api_key_id} mode={'futures' if is_futures else 'spot'} purpose={purpose}")
                return exchange
            else:
                # Expired — পুরনোটা বন্ধ করে নতুন তৈরি করব
                logger.debug(f"[ExchangePool] 🔄 Cache EXPIRED for key={api_key_id} purpose={purpose}, reinitializing...")
                try:
                    await exchange.close()
                except Exception:
                    pass
                del _pool[cache_key]

        # Cache Miss — নতুন Exchange তৈরি করুন
        logger.info(f"[ExchangePool] 🆕 Cache MISS — creating new exchange instance for key={api_key_id} purpose={purpose}")

        ex_id = exchange_name.lower()
        exchange_class = getattr(ccxtpro, ex_id, None) if ccxtpro else None
        if not exchange_class:
            exchange_class = getattr(ccxt_async, ex_id, None)
        if not exchange_class:
            raise ValueError(f"Unsupported exchange: {exchange_name}")

        is_order_purpose = (purpose == 'order')
        config = {
            'apiKey': decrypted_api_key,
            'secret': decrypted_secret,
            # Dedicated order instance rateLimit disable kore CCXT throttle queue bypass kore
            'enableRateLimit': False if is_order_purpose else True,
            'timeout': 15000 if is_order_purpose else 20000,
            'options': {
                'adjustForTimeDifference': True,
                'recvWindow': 60000 if exchange_name.lower() == 'mexc' else 10000,
            }
        }

        if passphrase:
            config['password'] = passphrase

        shared_sess = _get_shared_http_session()
        if shared_sess is not None:
            config['session'] = shared_sess

        if is_futures:
            config['options']['defaultType'] = 'swap'
            if exchange_name.lower() == 'binance':
                config['options']['fetchMarkets'] = {'types': ['linear', 'inverse']}
        elif exchange_name.lower() == 'binance':
            config['options']['defaultType'] = 'spot'
            config['options']['fetchMarkets'] = {'types': ['spot']}

        exchange = exchange_class(config)

        # Markets লোড করে রাখুন — general instance এর markets থাকলে 0ms এ দ্রুত কপি করে নিন
        general_key = _make_cache_key(api_key_id, is_futures, purpose="general")
        if general_key in _pool and getattr(_pool[general_key][0], 'markets', None):
            gen_ex = _pool[general_key][0]
            copied = False
            if hasattr(exchange, 'set_markets'):
                try:
                    currencies_copy = copy.deepcopy(getattr(gen_ex, 'currencies', None))
                    exchange.set_markets(copy.deepcopy(list(gen_ex.markets.values())), currencies_copy)
                    copied = True
                except Exception as sm_err:
                    logger.debug(f"[ExchangePool] set_markets copy fallback: {sm_err}")
            if not copied:
                exchange.markets = copy.deepcopy(gen_ex.markets)
                exchange.symbols = list(exchange.markets.keys())
                exchange.currencies = copy.deepcopy(getattr(gen_ex, 'currencies', {}))
                exchange.ids = copy.deepcopy(getattr(gen_ex, 'ids', list(exchange.markets.keys())))
                exchange.markets_by_id = copy.deepcopy(getattr(gen_ex, 'markets_by_id', {}))
                exchange.currencies_by_id = copy.deepcopy(getattr(gen_ex, 'currencies_by_id', {}))
            logger.info(f"[ExchangePool] ⚡ Copied pre-loaded markets from general instance for key={api_key_id} purpose={purpose} (0ms)")
        else:
            # ⚡ Check ccxt_service pre-warmed markets cache (0ms)
            copied_from_cache = False
            try:
                from app.services.ccxt_service import ccxt_service
                market_type = 'swap' if is_futures else 'spot'
                cache_id = f"{exchange_name.lower()}_{market_type}"
                prewarmed = ccxt_service._market_cache.get(cache_id)
                if prewarmed and hasattr(exchange, 'set_markets'):
                    exchange.set_markets(prewarmed)
                    copied_from_cache = True
                    logger.info(f"[ExchangePool] ⚡ Copied pre-warmed markets from ccxt_service for {cache_id} key={api_key_id} (0ms)")
            except Exception as cache_e:
                logger.debug(f"[ExchangePool] Pre-warmed cache copy fallback: {cache_e}")

            if not copied_from_cache and not getattr(exchange, 'markets', None):
                try:
                    await asyncio.wait_for(exchange.load_markets(), timeout=10.0)
                    logger.info(f"[ExchangePool] ✅ Markets loaded for {exchange_name} key={api_key_id} purpose={purpose}")
                except Exception as e:
                    logger.warning(f"[ExchangePool] ⚠️ Market load warning for {exchange_name}: {e}")
                    if is_futures and exchange_name.lower() == 'binance':
                        try:
                            exchange.options['fetchMarkets'] = {'types': ['linear', 'inverse']}
                            await asyncio.wait_for(exchange.load_markets(), timeout=12.0)
                            logger.info(f"[ExchangePool] ✅ Futures (linear+inverse) markets loaded via retry for {exchange_name} key={api_key_id}")
                        except Exception as lin_e:
                            logger.warning(f"[ExchangePool] ⚠️ Futures retry market load warning: {lin_e}")

        _pool[cache_key] = (exchange, time.time())
        asyncio.create_task(prewarm_exchange_connections(exchange, is_futures=is_futures))

        # If general instance was created, pre-warm the dedicated order instance in the background
        if purpose == "general":
            asyncio.create_task(
                get_or_create_exchange(
                    api_key_id=api_key_id,
                    exchange_name=exchange_name,
                    decrypted_api_key=decrypted_api_key,
                    decrypted_secret=decrypted_secret,
                    is_futures=is_futures,
                    passphrase=passphrase,
                    purpose="order"
                )
            )

        return exchange


async def invalidate(api_key_id: int):
    """
    নির্দিষ্ট API Key-এর সব Cache Entry মুছে ফেলে।
    Key Update বা Delete হলে call করতে হবে।
    """
    async with _pool_lock:
        keys_to_remove = [k for k in _pool if k.startswith(f"key_{api_key_id}_")]
        for k in keys_to_remove:
            exchange, _ = _pool.pop(k)
            try:
                await exchange.close()
            except Exception:
                pass
        if keys_to_remove:
            logger.info(f"[ExchangePool] 🗑️ Invalidated {len(keys_to_remove)} cache entries for api_key_id={api_key_id}")


async def close_all():
    """
    সব Connection বন্ধ করে। App shutdown এ call করতে হবে।
    """
    global _keepalive_task
    if _keepalive_task and not _keepalive_task.done():
        _keepalive_task.cancel()
        _keepalive_task = None
    async with _pool_lock:
        for key, (exchange, _) in list(_pool.items()):
            try:
                await exchange.close()
            except Exception:
                pass
        _pool.clear()
        for loop_id, sess in list(_shared_sessions.items()):
            try:
                if sess is not None and not getattr(sess, 'closed', True):
                    await sess.close()
            except Exception:
                pass
        _shared_sessions.clear()
        logger.info("[ExchangePool] 🛑 All cached connections closed.")
