import asyncio
import pytest

from app.services.trading_fee_service import TradingFeeService


def test_default_symbol_fees_spot_usdt_and_fdusd():
    usdt = TradingFeeService.get_default_symbol_fees("BTC/USDT", "binance")
    assert usdt["market_type"] == "spot"
    assert usdt["is_futures"] is False
    assert usdt["is_inverse"] is False
    assert usdt["maker_rate"] == pytest.approx(0.001)
    assert usdt["taker_rate"] == pytest.approx(0.001)
    assert usdt["bnb_discount_supported"] is True
    assert usdt["bnb_discount_rate"] == pytest.approx(0.25)

    fdusd = TradingFeeService.get_default_symbol_fees("DOGE/FDUSD", "binance")
    assert fdusd["market_type"] == "spot"
    assert fdusd["maker_rate"] == pytest.approx(0.0)
    assert fdusd["taker_rate"] == pytest.approx(0.001)
    assert "0% Maker" in fdusd["tier_label"]


def test_default_symbol_fees_usdm_and_coinm_futures():
    usdm = TradingFeeService.get_default_symbol_fees("BTC/USDT:USDT", "binance")
    assert usdm["market_type"] == "usdm_futures"
    assert usdm["is_futures"] is True
    assert usdm["is_inverse"] is False
    assert usdm["maker_rate"] == pytest.approx(0.0002)
    assert usdm["taker_rate"] == pytest.approx(0.0005)
    assert usdm["bnb_discount_rate"] == pytest.approx(0.10)

    coinm = TradingFeeService.get_default_symbol_fees("DOGE/USD:DOGE", "binance")
    assert coinm["market_type"] == "coinm_futures"
    assert coinm["is_futures"] is True
    assert coinm["is_inverse"] is True
    assert coinm["maker_rate"] == pytest.approx(0.0002)
    assert coinm["taker_rate"] == pytest.approx(0.0005)


def test_extract_live_exchange_rates_binance_spot_and_futures():
    class FakeBinanceSpot:
        markets = {"BTC/FDUSD": {"id": "BTCFDUSD", "maker": 0.001, "taker": 0.001}}
        has = {"fetchTradingFee": True}

        async def sapi_get_asset_tradefee(self, params):
            assert params["symbol"] == "BTCFDUSD"
            return [{"symbol": "BTCFDUSD", "makerCommission": "0", "takerCommission": "0.001"}]

    class FakeBinanceFutures:
        markets = {"BTC/USDT:USDT": {"id": "BTCUSDT", "maker": 0.0002, "taker": 0.0005}}
        has = {"fetchTradingFee": True}

        async def fapiPrivateGetCommissionRate(self, params):
            assert params["symbol"] == "BTCUSDT"
            return {"symbol": "BTCUSDT", "makerCommissionRate": "0.00018", "takerCommissionRate": "0.00045"}

    m1, t1, s1, label1 = asyncio.run(
        TradingFeeService._extract_live_exchange_rates(
            FakeBinanceSpot(), "BTC/FDUSD", "binance", "spot"
        )
    )
    assert m1 == pytest.approx(0.0)
    assert t1 == pytest.approx(0.001)
    assert s1 == "live_api"
    assert "0% Maker" in label1

    m2, t2, s2, label2 = asyncio.run(
        TradingFeeService._extract_live_exchange_rates(
            FakeBinanceFutures(), "BTC/USDT:USDT", "binance", "usdm_futures"
        )
    )
    assert m2 == pytest.approx(0.00018)
    assert t2 == pytest.approx(0.00045)
    assert s2 == "live_api"
    assert "USD-M Live" in label2
