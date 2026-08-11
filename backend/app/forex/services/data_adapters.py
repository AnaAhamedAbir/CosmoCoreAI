import random
import time
from typing import Dict, Any, List

class BaseDataAdapter:
    """Base class for all Forex market data adapters."""
    def get_latest_ticks(self) -> List[Dict[str, Any]]:
        raise NotImplementedError

class SimulatedBrokerAdapter(BaseDataAdapter):
    """
    Simulates highly realistic Forex tick data for various brokers.
    Different brokers have different spread profiles.
    """
    def __init__(self, broker_name: str):
        self.broker_name = broker_name
        
        # Base mid prices
        self.prices = {
            'EUR/USD': 1.09240,
            'GBP/USD': 1.26410,
            'USD/JPY': 149.325,
            'XAU/USD': 2024.50,
            'AUD/USD': 0.65210,
            'BTC/USD': 64200.1,
            'GBP/JPY': 188.450,
            'EUR/GBP': 0.85410,
            'USD/CAD': 1.34520,
            'NZD/USD': 0.60850,
        }
        
        # Define what pairs each broker supports in this simulation
        self.broker_pairs = {
            'Exness': ['EUR/USD', 'XAU/USD', 'BTC/USD'],
            'OANDA': ['EUR/USD', 'GBP/USD', 'USD/JPY'],
            'IC Markets': ['EUR/USD', 'AUD/USD', 'XAU/USD'],
            'IG': ['GBP/JPY', 'EUR/GBP', 'EUR/USD'],
            'Pepperstone': ['USD/CAD', 'NZD/USD', 'EUR/USD'],
        }
        
        # Spread profiles (in pips/points)
        self.spread_profiles = {
            'Exness': 0.0,
            'IC Markets': 0.1,
            'OANDA': 0.2,
            'Pepperstone': 0.2,
            'IG': 0.5,
        }

    def _generate_tick(self, symbol: str) -> Dict[str, Any]:
        base_spread = self.spread_profiles.get(self.broker_name, 0.2)
        
        # Add random noise to mid price
        volatility = 0.00005 if 'JPY' not in symbol else 0.005
        if 'XAU' in symbol: volatility = 0.05
        if 'BTC' in symbol: volatility = 1.0
        
        movement = random.uniform(-volatility, volatility)
        self.prices[symbol] += movement
        mid = self.prices[symbol]
        
        # Calculate dynamic spread (base + jitter)
        spread_jitter = random.uniform(0, 0.1) if base_spread > 0 else 0
        actual_spread_pips = base_spread + spread_jitter
        
        # Convert pip spread to actual price difference
        pip_multiplier = 0.01 if 'JPY' in symbol else 0.0001
        if 'XAU' in symbol or 'BTC' in symbol: pip_multiplier = 0.1
        
        half_spread = (actual_spread_pips * pip_multiplier) / 2
        
        bid = mid - half_spread
        ask = mid + half_spread
        
        # Format depending on pair
        decimals = 3 if 'JPY' in symbol else (2 if 'XAU' in symbol else (1 if 'BTC' in symbol else 5))
        
        return {
            "symbol": symbol,
            "bid": f"{bid:.{decimals}f}",
            "ask": f"{ask:.{decimals}f}",
            "spread": f"{actual_spread_pips:.1f}",
            "timestamp": time.time(),
            "broker": self.broker_name
        }

    def get_latest_ticks(self) -> List[Dict[str, Any]]:
        pairs = self.broker_pairs.get(self.broker_name, ['EUR/USD'])
        return [self._generate_tick(pair) for pair in pairs]

class DataAdapterFactory:
    @staticmethod
    def get_adapter(broker_name: str) -> BaseDataAdapter:
        # In the future, you could return OandaAdapter() if broker_name == 'OANDA' and API keys exist.
        return SimulatedBrokerAdapter(broker_name)
