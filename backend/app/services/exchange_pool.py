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
import time
import logging
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

# একটি Exchange Instance কতক্ষণ Cache এ থাকবে (seconds)
CACHE_TTL_SECONDS = 3600  # ১ ঘন্টা

def _make_cache_key(api_key_id: int, is_futures: bool, purpose: str = "general") -> str:
    """api_key_id, mode (spot/futures) এবং purpose দিয়ে unique key তৈরি করে।"""
    mode = "futures" if is_futures else "spot"
    if purpose and purpose != "general":
        return f"key_{api_key_id}_{mode}_{purpose}"
    return f"key_{api_key_id}_{mode}"


async def _keepalive_worker():
    """
    প্রতি 30 সেকেন্ডে পুলের প্রতিটি Active Exchange-এ একটি হালকা public ping (fetch_time) পাঠায়।
    এতে TCP connection এবং TLS 1.3 session উষ্ণ (warm/alive) থাকে।
    পরবর্তী অর্ডারে 3-way handshake বা TLS renegotiation এর ~400ms নেটওয়ার্ক পেনাল্টি সম্পূর্ণ দূর হয়।
    """
    while True:
        try:
            await asyncio.sleep(30)
            async with _pool_lock:
                instances = [ex for (ex, _) in list(_pool.values())]
            for ex in instances:
                try:
                    if hasattr(ex, 'fetch_time') and not getattr(ex, 'closed', False):
                        await asyncio.wait_for(ex.fetch_time(), timeout=3.0)
                except Exception:
                    pass
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
                                exchange.options['fetchMarkets'] = {'types': ['linear']}
                                await asyncio.wait_for(exchange.load_markets(), timeout=8.0)
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
                            exchange.options['fetchMarkets'] = {'types': ['linear']}
                            await asyncio.wait_for(exchange.load_markets(), timeout=8.0)
                            logger.info(f"[ExchangePool] ✅ Linear Futures markets loaded via fallback for {exchange_name} key={api_key_id}")
                        except Exception as lin_e:
                            logger.warning(f"[ExchangePool] ⚠️ Linear fallback market load warning: {lin_e}")

        _pool[cache_key] = (exchange, time.time())

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
        logger.info("[ExchangePool] 🛑 All cached connections closed.")
